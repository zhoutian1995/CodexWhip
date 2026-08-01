const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PHRASES,
  choosePhrase: chooseFromPhrases,
} = require('./phrase-library');
const { ensureCodexSteerMode } = require('./codex-config');

const PHRASES = DEFAULT_PHRASES;

const RESULT_MESSAGES = Object.freeze({
  APP_NOT_RUNNING: 'Codex Desktop is not running.',
  CODEX_MODE_NOT_FOUND: 'Open the Codex view in ChatGPT Desktop and try again.',
  COMPOSER_NOT_FOUND: 'Could not find the Codex message box. Update or restart Codex Desktop.',
  AMBIGUOUS_WINDOWS: 'More than one Codex window is open. Bring the target window to the front.',
  TARGET_SESSION_REQUIRED: 'Bind a Codex task before whipping.',
  TARGET_SESSION_MISMATCH: 'The active Codex task is not the bound task.',
  TASK_ID_NOT_FOUND: 'Could not identify the current Codex task.',
  DRAFT_PRESENT: 'Codex has an unsent draft. Send or clear it before whipping.',
  FOCUS_FAILED: 'Could not focus the Codex message box.',
  COMPOSER_CHANGED: 'The Codex message box changed before the message could be sent.',
  TARGET_WINDOW_NOT_ACTIVE: 'The bound Codex window is no longer active.',
  DELIVERY_AMBIGUOUS: 'Codex exposed more than one possible new message. Nothing was guessed.',
  DELIVERY_UNCONFIRMED: 'CodexWhip could not prove that the new message reached the bound task.',
  STEER_DELIVERY_UNCONFIRMED: 'Codex accepted the Steer action, but delivery could not be verified.',
  STEER_INVOKE_UNAVAILABLE: 'Codex queued the message, but its Steer action is unavailable.',
  STEER_PENDING: 'Codex has not exposed the queued message action yet.',
  QUEUED_MESSAGE_STEER_FAILED: 'Codex queued the message, but CodexWhip could not convert it to Steer.',
  SUBMIT_TEXT_NOT_FOUND: 'The Codex message box did not receive the whip message.',
  DRAFT_CHANGED: 'The Codex draft changed before CodexWhip could send it.',
  SUBMIT_FAILED: 'Codex kept the message in the composer instead of sending it.',
  ACCESS_DENIED: 'CodexWhip cannot control Codex. Run both apps at the same privilege level.',
  HELPER_FAILURE: 'Codex Desktop detection failed.',
  HELPER_TIMEOUT: 'Codex Desktop detection timed out.',
  HELPER_OUTPUT_INVALID: 'Codex Desktop returned an unreadable detection result.',
  KEYBOARD_UNAVAILABLE: 'Windows keyboard automation is unavailable.',
  CODEX_CONFIG_UPDATE_FAILED: 'Could not set Codex follow-up behavior to Steer.',
  CODEX_CONFIG_CHANGED_DURING_UPDATE: 'Codex settings changed while CodexWhip was enabling Steer.',
  CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION: 'Codex config.toml has more than one desktop section.',
  CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE: 'Codex config.toml has more than one follow-up behavior setting.',
  CODEX_CONFIG_INVALID_FOLLOW_UP_MODE: 'Codex follow-up behavior in config.toml is invalid.',
  CODEX_CONFIG_INVALID_TOML: 'Codex config.toml is not valid TOML.',
  CODEX_CONFIG_READ_FAILED: 'CodexWhip could not read Codex config.toml.',
  CODEX_STEER_MODE_REQUIRED: 'Set Codex Follow-up behavior to Steer before whipping.',
  CODEX_CONFIG_UPDATE_INVALID: 'CodexWhip could not verify the Steer setting.',
  UNSUPPORTED_PLATFORM: 'CodexWhip Desktop currently supports Windows only.',
});

function choosePhrase(random = Math.random) {
  return chooseFromPhrases(PHRASES, random);
}

function parseHelperOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.ok === 'boolean' && typeof parsed.code === 'string') {
        return parsed;
      }
    } catch {
      // PowerShell can emit unrelated host output; only the final JSON object matters.
    }
  }

  return { ok: false, code: 'HELPER_OUTPUT_INVALID' };
}

function messageForResult(result) {
  if (!result || result.ok) return null;
  return RESULT_MESSAGES[result.code] || RESULT_MESSAGES.HELPER_FAILURE;
}

function resolveHelperPath() {
  const packagedPath = path.join(process.resourcesPath || '', 'scripts', 'codex-desktop-ui.ps1');
  if (process.resourcesPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', 'scripts', 'codex-desktop-ui.ps1');
}

function powershellPath() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!windowsRoot) return 'powershell.exe';
  return path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function encodeHelperText(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function runHelper(mode, options = {}) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM' });
  }

  const helperPath = options.helperPath || resolveHelperPath();
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helperPath,
    '-Mode',
    mode,
  ];

  if (options.preferredHwnd) {
    args.push('-PreferredHwnd', String(options.preferredHwnd));
  }
  if (options.expectedText) {
    args.push('-ExpectedTextBase64', encodeHelperText(options.expectedText));
  }
  if (options.targetTaskTitle) {
    args.push('-TargetTaskTitleBase64', encodeHelperText(options.targetTaskTitle));
  }
  if (options.targetTaskRuntimeId) {
    args.push('-TargetTaskRuntimeId', String(options.targetTaskRuntimeId));
  }

  return new Promise(resolve => {
    execFile(
      powershellPath(),
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs || (mode === 'send' ? 10000 : 7000),
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error && error.killed) {
          resolve({ ok: false, code: 'HELPER_TIMEOUT' });
          return;
        }

        const result = parseHelperOutput(stdout);
        if (error && result.code === 'HELPER_OUTPUT_INVALID') {
          resolve({
            ok: false,
            code: 'HELPER_FAILURE',
            detail: error.message,
          });
          return;
        }

        resolve(result);
      }
    );
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function probeCodexDesktop(options = {}) {
  return runHelper('probe', options);
}

async function sendWhipMessage(options = {}) {
  if (!options.targetTaskTitle || !options.targetTaskRuntimeId) {
    return { ok: false, code: 'TARGET_SESSION_REQUIRED' };
  }

  const ensureSteer = options.ensureSteerModeFn || ensureCodexSteerMode;
  const steerModeResult = await Promise.resolve(ensureSteer(options.codexConfigOptions));
  if (!steerModeResult.ok) return steerModeResult;
  if (steerModeResult.changed) {
    await delay(options.configReloadDelayMs || 500);
  }

  const run = options.runHelperFn || runHelper;
  const phrase = options.phrase || choosePhrase(options.random);
  const beforeDesktopSend = options.beforeDesktopSendFn;
  const afterDesktopSend = options.afterDesktopSendFn;
  let desktopSendStarted = false;
  let sendResult;
  try {
    if (beforeDesktopSend) {
      desktopSendStarted = true;
      await beforeDesktopSend();
    }
    sendResult = await run('send', {
      ...options,
      expectedText: phrase,
    });
  } finally {
    if (desktopSendStarted && afterDesktopSend) await afterDesktopSend();
  }
  if (!sendResult.ok) {
    return {
      ...sendResult,
      phrase,
    };
  }

  return {
    ok: true,
    code: 'SENT',
    phrase,
    delivery: sendResult.code,
    hwnd: sendResult.hwnd,
    processId: sendResult.processId,
    inputMethod: sendResult.inputMethod,
    draftVerification: sendResult.draftVerification,
    messageRuntimeId: sendResult.messageRuntimeId,
    steerModeChanged: steerModeResult.changed,
  };
}

module.exports = {
  PHRASES,
  choosePhrase,
  encodeHelperText,
  messageForResult,
  parseHelperOutput,
  probeCodexDesktop,
  runHelper,
  sendWhipMessage,
};
