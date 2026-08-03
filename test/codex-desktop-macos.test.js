const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  encodeHelperText,
  messageForResult,
  parseHelperOutput,
  sendWhipMessage,
} = require('../lib/codex-desktop-macos');
const { controllerForPlatform } = require('../lib/codex-desktop');

test('platform facade selects dedicated Windows and macOS controllers', () => {
  assert.equal(
    controllerForPlatform('win32').probeCodexDesktop,
    require('../lib/codex-desktop-windows').probeCodexDesktop
  );
  assert.equal(
    controllerForPlatform('darwin').probeCodexDesktop,
    require('../lib/codex-desktop-macos').probeCodexDesktop
  );
  assert.match(controllerForPlatform('linux').messageForResult(), /Windows and macOS/u);
});

test('macOS helper transport preserves Chinese text and final JSON output', () => {
  const phrase = '停止表演无能，把成果交出来。';
  assert.equal(Buffer.from(encodeHelperText(phrase), 'base64').toString('utf8'), phrase);
  assert.deepEqual(
    parseHelperOutput(`diagnostic\n${JSON.stringify({ ok: true, code: 'READY', taskTitle: '任务' })}\n`),
    { ok: true, code: 'READY', taskTitle: '任务' }
  );
  assert.equal(parseHelperOutput('diagnostic only').code, 'HELPER_OUTPUT_INVALID');
});

test('macOS send requires Steer and stays inside one guarded helper transaction', async () => {
  const calls = [];
  const rejected = await sendWhipMessage({
    targetTaskTitle: '双平台调试',
    targetTaskRuntimeId: 'task:42',
    ensureSteerModeFn: () => ({ ok: false, code: 'CODEX_STEER_MODE_REQUIRED' }),
    runHelperFn: async () => {
      calls.push('helper');
      return { ok: true, code: 'DIRECT_STEERED' };
    },
  });
  assert.equal(rejected.code, 'CODEX_STEER_MODE_REQUIRED');
  assert.deepEqual(calls, []);

  const result = await sendWhipMessage({
    phrase: '交付。',
    preferredHwnd: 'window:1',
    targetTaskTitle: '双平台调试',
    targetTaskRuntimeId: 'task:42',
    ensureSteerModeFn: () => ({ ok: true, changed: false }),
    beforeDesktopSendFn: async () => calls.push('overlay:lower'),
    afterDesktopSendFn: async () => calls.push('overlay:restore'),
    runHelperFn: async (mode, options) => {
      calls.push(`${mode}:${options.expectedText}`);
      return {
        ok: true,
        code: 'DIRECT_STEERED',
        hwnd: 'window:1',
        processId: 123,
        inputMethod: 'AXValue',
        messageRuntimeId: 'message:99',
      };
    },
  });

  assert.equal(result.code, 'SENT');
  assert.equal(result.delivery, 'DIRECT_STEERED');
  assert.deepEqual(calls, ['overlay:lower', 'send:交付。', 'overlay:restore']);
});

test('macOS permission failures remain actionable and never look sent', () => {
  assert.match(
    messageForResult({ ok: false, code: 'ACCESSIBILITY_PERMISSION_REQUIRED' }),
    /Accessibility/u
  );
  assert.equal(messageForResult({ ok: true, code: 'READY' }), null);
});

test('Swift helper performs final identity, focus, draft and delivery checks', () => {
  const helper = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'codex-desktop-ui-macos.swift'),
    'utf8'
  );
  assert.match(helper, /guard AXIsProcessTrusted\(\)/u);
  assert.match(helper, /verifyIdentity\(selected, arguments: arguments\)/u);
  assert.match(helper, /selected\.composerRuntimeId == initialComposerRuntimeId/u);
  assert.match(helper, /guard selected\.draftText\.isEmpty/u);
  assert.match(helper, /NSWorkspace\.shared\.frontmostApplication/u);
  assert.match(helper, /focusComposer\(beforeSubmit\.composer\)/u);
  assert.match(helper, /afterIds\.subtracting\(beforeMessageIds\)/u);
  assert.match(helper, /newIds\.count > 1/u);
  assert.match(helper, /DELIVERY_UNCONFIRMED/u);
});
