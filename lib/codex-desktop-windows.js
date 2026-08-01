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
  CODEX_CONFIG_UPDATE_INVALID: 'CodexWhip could not verify the Steer setting.',
  UNSUPPORTED_PLATFORM: 'CodexWhip Desktop currently supports Windows only.',
});

const INPUT_KEYBOARD = 1;
const VK_RETURN = 0x0d;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

let keyboardApi;

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
        timeout: options.timeoutMs || 7000,
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

function loadKeyboardApi() {
  if (keyboardApi !== undefined) return keyboardApi;

  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const mouseInput = koffi.struct('MOUSEINPUT', {
      dx: 'long',
      dy: 'long',
      mouseData: 'uint32_t',
      dwFlags: 'uint32_t',
      time: 'uint32_t',
      dwExtraInfo: 'uintptr_t',
    });
    const keyboardInput = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16_t',
      wScan: 'uint16_t',
      dwFlags: 'uint32_t',
      time: 'uint32_t',
      dwExtraInfo: 'uintptr_t',
    });
    const hardwareInput = koffi.struct('HARDWAREINPUT', {
      uMsg: 'uint32_t',
      wParamL: 'uint16_t',
      wParamH: 'uint16_t',
    });
    const input = koffi.struct('INPUT', {
      type: 'uint32_t',
      u: koffi.union({
        mi: mouseInput,
        ki: keyboardInput,
        hi: hardwareInput,
      }),
    });

    keyboardApi = {
      input,
      inputSize: koffi.sizeof(input),
      sendInput: user32.func(
        'unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)'
      ),
    };
  } catch {
    keyboardApi = null;
  }

  return keyboardApi;
}

function unicodeKeyEvent(codeUnit, isKeyUp) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: 0,
        wScan: codeUnit,
        dwFlags: KEYEVENTF_UNICODE | (isKeyUp ? KEYEVENTF_KEYUP : 0),
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

function virtualKeyEvent(virtualKey, isKeyUp) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: virtualKey,
        wScan: 0,
        dwFlags: isKeyUp ? KEYEVENTF_KEYUP : 0,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

function keyboardApiFor(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'keyboardApi')) {
    return options.keyboardApi;
  }
  return loadKeyboardApi();
}

async function typeText(text, options = {}) {
  const api = keyboardApiFor(options);
  if (!api) return { ok: false, code: 'KEYBOARD_UNAVAILABLE' };

  for (let index = 0; index < text.length; index++) {
    const codeUnit = text.charCodeAt(index);
    const events = [
      unicodeKeyEvent(codeUnit, false),
      unicodeKeyEvent(codeUnit, true),
    ];
    if (api.sendInput(events.length, events, api.inputSize) !== events.length) {
      return { ok: false, code: 'KEYBOARD_UNAVAILABLE' };
    }
    await delay(options.characterDelayMs || 8);
  }

  return { ok: true, code: 'TYPED' };
}

async function pressEnter(options = {}) {
  const api = keyboardApiFor(options);
  if (!api) return { ok: false, code: 'KEYBOARD_UNAVAILABLE' };

  const events = [
    virtualKeyEvent(VK_RETURN, false),
    virtualKeyEvent(VK_RETURN, true),
  ];
  if (api.sendInput(events.length, events, api.inputSize) !== events.length) {
    return { ok: false, code: 'KEYBOARD_UNAVAILABLE' };
  }

  return { ok: true, code: 'ENTER_PRESSED' };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function probeCodexDesktop(options = {}) {
  return runHelper('probe', options);
}

async function ensureSteerDelivery(options = {}) {
  const run = options.runHelperFn || runHelper;
  const wait = options.delayFn || delay;
  const now = options.nowFn || Date.now;
  const timeoutMs = options.dispatchTimeoutMs ?? 2500;
  const pollMs = options.dispatchPollMs ?? 250;
  const deadline = now() + timeoutMs;
  let lastResult = { ok: false, code: 'STEER_PENDING' };

  do {
    lastResult = await run('steer', options);
    if (lastResult.ok) return lastResult;
    if (!['STEER_PENDING', 'STEER_INVOKE_UNAVAILABLE'].includes(lastResult.code)) {
      return lastResult;
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(pollMs, remaining));
  } while (now() <= deadline);

  return {
    ok: false,
    code: 'QUEUED_MESSAGE_STEER_FAILED',
    detail: lastResult.code,
  };
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
  const wait = options.delayFn || delay;
  const phrase = options.phrase || choosePhrase(options.random);
  const beforeDesktopSend = options.beforeDesktopSendFn;
  const afterDesktopSend = options.afterDesktopSendFn;
  let desktopSendStarted = false;
  let writeResult;
  let submitResult;
  try {
    if (beforeDesktopSend) {
      desktopSendStarted = true;
      await beforeDesktopSend();
    }
    writeResult = await run('write', {
      ...options,
      expectedText: phrase,
    });
    if (!writeResult.ok) {
      return {
        ...writeResult,
        phrase,
      };
    }
    submitResult = await run('commit', {
      ...options,
      preferredHwnd: writeResult.hwnd,
      expectedText: phrase,
    });
  } finally {
    if (desktopSendStarted && afterDesktopSend) await afterDesktopSend();
  }
  if (!submitResult.ok) {
    return {
      ...submitResult,
      phrase,
    };
  }

  await wait(options.dispatchDelayMs || 200);
  const dispatchResult = await ensureSteerDelivery({
    ...options,
    preferredHwnd: submitResult.hwnd,
    expectedText: phrase,
  });
  if (!dispatchResult.ok) {
    return {
      ...dispatchResult,
      phrase,
    };
  }

  return {
    ok: true,
    code: 'SENT',
    phrase,
    delivery: dispatchResult.code,
    hwnd: submitResult.hwnd,
    processId: submitResult.processId,
    inputMethod: writeResult.inputMethod,
    draftVerification: writeResult.draftVerification,
    steerModeChanged: steerModeResult.changed,
  };
}

module.exports = {
  PHRASES,
  choosePhrase,
  encodeHelperText,
  ensureSteerDelivery,
  messageForResult,
  parseHelperOutput,
  pressEnter,
  probeCodexDesktop,
  runHelper,
  sendWhipMessage,
  typeText,
  virtualKeyEvent,
};
