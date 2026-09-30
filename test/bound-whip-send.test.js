const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const mainPath = path.join(ROOT, 'main.js');
const source = fs.readFileSync(mainPath, 'utf8');
const requireFromMain = createRequire(mainPath);
const CHINESE_PHRASE = 'Codex，停止表演无能，把成果交出来。';
const TARGET = Object.freeze({
  ok: true,
  code: 'READY',
  hwnd: 'window:bound',
  processId: 42,
  taskTitle: '专用鞭子测试会话',
  taskRuntimeId: 'task:bound',
  taskTitleMatchCount: 1,
});

function loadMain({ probeResult = TARGET, sendResult, phraseOpenError = '' } = {}) {
  const handlers = new Map();
  const sent = [];
  const saved = [];
  const events = [];
  const opened = [];
  const context = vm.createContext({
    __dirname: ROOT,
    process,
    console: { log() {}, warn() {} },
    setTimeout,
    clearTimeout,
    require(moduleId) {
      if (moduleId === 'electron') {
        return {
          // Loading the IPC handlers does not start Electron or inspect any app.
          app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
          ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
          globalShortcut: { register: () => true, unregister() {} },
          shell: {
            openPath: async filePath => {
              events.push('phrases:open');
              opened.push(filePath);
              return phraseOpenError;
            },
          },
        };
      }
      if (moduleId === 'node:child_process') {
        return {
          execFile: (_command, _args, callback) => {
            events.push('fallback:open');
            callback(new Error('mock editor unavailable'));
          },
        };
      }
      if (moduleId === './lib/codex-desktop') {
        return {
          messageForResult: result => result.code,
          probeCodexDesktop: async () => ({ ...probeResult }),
          sendWhipMessage: async options => {
            sent.push(options);
            return sendResult || {
              ok: true,
              code: 'SENT',
              phrase: options.phrase,
              delivery: 'MESSAGE_DELIVERED',
              hwnd: options.preferredHwnd,
              processId: TARGET.processId,
            };
          },
        };
      }
      if (moduleId === './lib/binding-store') {
        return {
          ...requireFromMain(moduleId),
          saveBinding: (filePath, taskTitle) => {
            saved.push({ filePath, taskTitle });
            return { ok: true, code: 'BINDING_SAVED' };
          },
          loadBinding: () => ({ ok: false, code: 'BINDING_NOT_FOUND' }),
        };
      }
      return requireFromMain(moduleId);
    },
  });
  vm.runInContext(source, context, { filename: mainPath });
  vm.runInContext('phraseLibrary = { choose: () => testPhrase };', Object.assign(context, {
    testPhrase: CHINESE_PHRASE,
  }));
  function installOverlay(visible = true) {
    const state = { visible };
    context.testOverlay = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false },
      isVisible: () => state.visible,
      hide: () => {
        events.push('overlay:hide');
        state.visible = false;
      },
      show: () => {
        events.push('overlay:show');
        state.visible = true;
      },
    };
    context.testPhraseFilePath = '/virtual/codexwhip/phrases.json';
    vm.runInContext('overlay = testOverlay; phraseFilePath = testPhraseFilePath;', context);
    return state;
  }
  return { handlers, sent, saved, events, opened, installOverlay };
}

test('binding then whipping sends a Chinese library phrase to that exact session', async () => {
  const { handlers, sent, saved } = loadMain();

  const binding = await handlers.get('bind-current-session')();
  const response = await handlers.get('whip-crack')();

  assert.equal(binding.code, 'SESSION_BOUND');
  assert.equal(saved[0].taskTitle, TARGET.taskTitle);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phrase, CHINESE_PHRASE);
  assert.equal(sent[0].preferredHwnd, TARGET.hwnd);
  assert.equal(sent[0].targetTaskTitle, TARGET.taskTitle);
  assert.equal(sent[0].targetTaskRuntimeId, TARGET.taskRuntimeId);
  assert.equal(typeof sent[0].beforeDesktopSendFn, 'function');
  assert.equal(typeof sent[0].afterDesktopSendFn, 'function');
  assert.equal(response.status, 'sent');
  assert.equal(response.phrase, CHINESE_PHRASE);
});

test('whipping without a verified binding never invokes desktop delivery', async () => {
  const { handlers, sent } = loadMain({
    probeResult: { ok: false, code: 'TASK_ID_NOT_FOUND' },
  });

  const binding = await handlers.get('bind-current-session')();
  const response = await handlers.get('whip-crack')();

  assert.equal(binding.ok, false);
  assert.equal(response.status, 'unbound');
  assert.equal(response.code, 'TARGET_SESSION_REQUIRED');
  assert.equal(sent.length, 0);
});

test('a mismatched active task is reported as refused rather than sent', async () => {
  const { handlers, sent } = loadMain({
    sendResult: { ok: false, code: 'TARGET_SESSION_MISMATCH' },
  });
  await handlers.get('bind-current-session')();

  const response = await handlers.get('whip-crack')();

  assert.equal(sent[0].targetTaskRuntimeId, TARGET.taskRuntimeId);
  assert.equal(response.status, 'session-mismatch');
  assert.equal(response.code, 'TARGET_SESSION_MISMATCH');
});

test('opening the phrase library hides the full-screen whip before opening the editor', async () => {
  const { handlers, sent, events, opened, installOverlay } = loadMain();
  const overlay = installOverlay();

  const response = await handlers.get('open-phrase-library')();

  assert.deepEqual(events, ['overlay:hide', 'phrases:open']);
  assert.deepEqual(opened, ['/virtual/codexwhip/phrases.json']);
  assert.equal(overlay.visible, false);
  assert.equal(response.ok, true);
  assert.equal(response.code, 'PHRASE_LIBRARY_OPENED');
  assert.equal(sent.length, 0);
});

test('a phrase editor failure restores the previously visible whip without sending a prompt', async () => {
  const { handlers, sent, events, installOverlay } = loadMain({
    phraseOpenError: 'No editor available',
  });
  const overlay = installOverlay();

  const response = await handlers.get('open-phrase-library')();

  assert.deepEqual(events, ['overlay:hide', 'phrases:open', 'fallback:open', 'overlay:show']);
  assert.equal(overlay.visible, true);
  assert.equal(response.ok, false);
  assert.equal(response.code, 'PHRASE_LIBRARY_OPEN_FAILED');
  assert.equal(sent.length, 0);
});
