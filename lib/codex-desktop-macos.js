const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_PHRASES,
  choosePhrase: chooseFromPhrases,
} = require('./phrase-library');
const { ensureCodexSteerMode } = require('./codex-config');

const PHRASES = DEFAULT_PHRASES;

const RESULT_MESSAGES = Object.freeze({
  APP_NOT_RUNNING: 'Codex Desktop is not running.',
  ACCESSIBILITY_PERMISSION_REQUIRED: 'Allow CodexWhip in macOS Privacy & Security > Accessibility.',
  CODEX_MODE_NOT_FOUND: 'Open a Codex task and try again.',
  SESSION_NOT_STABLE: 'The Codex session is still changing. Leave the target task open and try again.',
  COMPOSER_NOT_FOUND: 'Could not find the Codex message box.',
  AMBIGUOUS_WINDOWS: 'More than one Codex window is open. Bring the target window to the front.',
  TARGET_SESSION_REQUIRED: 'Bind a Codex task before whipping.',
  TARGET_SESSION_MISMATCH: 'The active Codex task is not the bound task.',
  TARGET_WINDOW_NOT_ACTIVE: 'The bound Codex window could not be activated safely.',
  TASK_ID_NOT_FOUND: 'Could not identify the current Codex task.',
  DRAFT_PRESENT: 'Codex has an unsent draft.',
  FOCUS_FAILED: 'Could not verify focus inside the bound Codex composer.',
  COMPOSER_CHANGED: 'The Codex message box changed before delivery.',
  SUBMIT_TEXT_NOT_FOUND: 'The Codex message box did not receive the whip message.',
  DRAFT_CHANGED: 'The Codex draft changed before delivery.',
  SUBMIT_FAILED: 'Codex kept the message in the composer instead of sending it.',
  DELIVERY_AMBIGUOUS: 'More than one new matching message appeared. Nothing was guessed.',
  DELIVERY_UNCONFIRMED: 'CodexWhip could not prove delivery to the bound task.',
  HELPER_MISSING: 'The macOS Accessibility helper is missing.',
  HELPER_FAILURE: 'Codex Desktop detection failed.',
  HELPER_TIMEOUT: 'Codex Desktop detection timed out.',
  HELPER_OUTPUT_INVALID: 'Codex Desktop returned an unreadable detection result.',
  CODEX_STEER_MODE_REQUIRED: 'Set Codex Follow-up behavior to Steer before whipping.',
  UNSUPPORTED_PLATFORM: 'CodexWhip Desktop supports Windows and macOS only.',
});

function choosePhrase(random = Math.random) {
  return chooseFromPhrases(PHRASES, random);
}

function parseHelperOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/u)
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
      // The helper may emit operating-system diagnostics before its final JSON result.
    }
  }

  return { ok: false, code: 'HELPER_OUTPUT_INVALID' };
}

function messageForResult(result) {
  if (!result || result.ok) return null;
  return RESULT_MESSAGES[result.code] || RESULT_MESSAGES.HELPER_FAILURE;
}

function resolveHelperPath() {
  const packagedPath = path.join(process.resourcesPath || '', 'scripts', 'codex-desktop-ui');
  if (process.resourcesPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', 'build', 'macos', 'codex-desktop-ui');
}

function encodeHelperText(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function runHelper(mode, options = {}) {
  if (process.platform !== 'darwin' && !options.allowUnsupportedPlatform) {
    return Promise.resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM' });
  }

  const helperPath = options.helperPath || resolveHelperPath();
  if (!fs.existsSync(helperPath)) {
    return Promise.resolve({ ok: false, code: 'HELPER_MISSING', helperPath });
  }

  const args = ['--mode', mode];
  if (options.preferredHwnd) args.push('--preferred-window-id', String(options.preferredHwnd));
  if (options.expectedText) args.push('--expected-text-base64', encodeHelperText(options.expectedText));
  if (options.targetTaskTitle) {
    args.push('--target-task-title-base64', encodeHelperText(options.targetTaskTitle));
  }
  if (options.targetTaskRuntimeId) {
    args.push('--target-task-runtime-id', String(options.targetTaskRuntimeId));
  }

  return new Promise(resolve => {
    execFile(
      helperPath,
      args,
      {
        timeout: options.timeoutMs || (mode === 'send' ? 12000 : 8000),
        encoding: 'utf8',
        maxBuffer: mode === 'dump' ? 8 * 1024 * 1024 : 1024 * 1024,
      },
      (error, stdout) => {
        if (error?.killed) {
          resolve({ ok: false, code: 'HELPER_TIMEOUT' });
          return;
        }

        const result = parseHelperOutput(stdout);
        if (error && result.code === 'HELPER_OUTPUT_INVALID') {
          resolve({ ok: false, code: 'HELPER_FAILURE', detail: error.message });
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
  if (steerModeResult.changed) await delay(options.configReloadDelayMs || 500);

  const phrase = options.phrase || choosePhrase(options.random);
  const run = options.runHelperFn || runHelper;
  let desktopSendStarted = false;
  let sendResult;
  try {
    if (options.beforeDesktopSendFn) {
      desktopSendStarted = true;
      await options.beforeDesktopSendFn();
    }
    sendResult = await run('send', { ...options, expectedText: phrase });
  } finally {
    if (desktopSendStarted && options.afterDesktopSendFn) {
      await options.afterDesktopSendFn();
    }
  }

  if (!sendResult.ok) return { ...sendResult, phrase };
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
  resolveHelperPath,
  runHelper,
  sendWhipMessage,
};
