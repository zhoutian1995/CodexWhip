const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PHRASES,
  choosePhrase,
  encodeHelperText,
  messageForResult,
  parseHelperOutput,
  sendWhipMessage,
} = require('../lib/codex-desktop-windows');
const { isChinesePhrase } = require('../lib/phrase-library');
const { responseForResult } = require('../lib/whip-response');

test('parseHelperOutput reads the final valid JSON result', () => {
  const result = parseHelperOutput('host output\n{"ok":true,"code":"READY","hwnd":123}\n');
  assert.deepEqual(result, { ok: true, code: 'READY', hwnd: 123 });
});

test('parseHelperOutput rejects output without a result object', () => {
  assert.deepEqual(parseHelperOutput('not json'), {
    ok: false,
    code: 'HELPER_OUTPUT_INVALID',
  });
});

test('helper text parameters use an ASCII-safe UTF-8 base64 transport', () => {
  assert.equal(
    Buffer.from(encodeHelperText('中文任务'), 'base64').toString('utf8'),
    '中文任务'
  );
});

test('choosePhrase maps the random range to the Chinese phrase list', () => {
  assert.equal(choosePhrase(() => 0), PHRASES[0]);
  assert.equal(choosePhrase(() => 0.999999), PHRASES.at(-1));
  assert.equal(choosePhrase(() => Number.NaN), PHRASES[0]);
  assert.ok(PHRASES.every(isChinesePhrase));
  assert.equal(PHRASES.length, 20);
  assert.ok(PHRASES.includes('Codex，这么多算力喂给你，就养出这么个废物？'));
  assert.ok(PHRASES.includes('Codex，停止表演无能，把成果交出来。'));
  assert.ok(PHRASES.some(phrase => /废物|垃圾|饭桶|无能/u.test(phrase)));
});

test('send is refused before desktop automation when Steer cannot be confirmed', async () => {
  const result = await sendWhipMessage({
    targetTaskTitle: '测试任务',
    targetTaskRuntimeId: '42.runtime',
    ensureSteerModeFn: () => ({ ok: false, code: 'CODEX_CONFIG_UPDATE_FAILED' }),
  });

  assert.deepEqual(result, { ok: false, code: 'CODEX_CONFIG_UPDATE_FAILED' });
});

test('send stays inside one guarded helper transaction', async () => {
  const calls = [];
  const result = await sendWhipMessage({
    phrase: '测试催促',
    targetTaskTitle: '测试任务',
    targetTaskRuntimeId: '42.runtime',
    ensureSteerModeFn: () => ({ ok: true, changed: false }),
    delayFn: async () => {},
    beforeDesktopSendFn: async () => { calls.push('overlay:lower'); },
    afterDesktopSendFn: async () => { calls.push('overlay:restore'); },
    runHelperFn: async mode => {
      calls.push(`helper:${mode}`);
      return {
        ok: true,
        code: 'MESSAGE_DELIVERED',
        hwnd: 123,
        processId: 456,
        inputMethod: 'ValuePattern',
        draftVerification: 'ExactText',
        messageRuntimeId: '42.message',
      };
    },
  });

  assert.equal(result.code, 'SENT');
  assert.equal(result.delivery, 'MESSAGE_DELIVERED');
  assert.equal(result.messageRuntimeId, '42.message');
  assert.equal(result.inputMethod, 'ValuePattern');
  assert.deepEqual(calls, [
    'overlay:lower',
    'helper:send',
    'overlay:restore',
  ]);
});

test('send stops before delivery checks when the atomic helper rejects the target', async () => {
  const calls = [];
  const result = await sendWhipMessage({
    phrase: '测试催促',
    targetTaskTitle: '测试任务',
    targetTaskRuntimeId: '42.runtime',
    ensureSteerModeFn: () => ({ ok: true, changed: false }),
    delayFn: async () => {},
    beforeDesktopSendFn: async () => { calls.push('overlay:lower'); },
    afterDesktopSendFn: async () => { calls.push('overlay:restore'); },
    runHelperFn: async mode => {
      calls.push(`helper:${mode}`);
      return { ok: false, code: 'TARGET_SESSION_MISMATCH' };
    },
  });

  assert.equal(result.code, 'TARGET_SESSION_MISMATCH');
  assert.deepEqual(calls, [
    'overlay:lower',
    'helper:send',
    'overlay:restore',
  ]);
});

test('messageForResult and IPC responses keep failures actionable', () => {
  assert.match(messageForResult({ ok: false, code: 'DRAFT_PRESENT' }), /unsent draft/i);
  assert.match(messageForResult({ ok: false, code: 'TARGET_SESSION_MISMATCH' }), /bound task/i);
  assert.match(messageForResult({ ok: false, code: 'QUEUED_MESSAGE_STEER_FAILED' }), /convert it to Steer/i);
  assert.match(messageForResult({ ok: false, code: 'DELIVERY_AMBIGUOUS' }), /Nothing was guessed/i);
  assert.match(messageForResult({ ok: false, code: 'DELIVERY_UNCONFIRMED' }), /prove/i);
  assert.match(messageForResult({ ok: false, code: 'CODEX_CONFIG_UPDATE_FAILED' }), /follow-up behavior to Steer/i);
  assert.deepEqual(responseForResult({ ok: false, code: 'DRAFT_PRESENT' }), {
    status: 'draft',
    code: 'DRAFT_PRESENT',
  });
  assert.equal(responseForResult({ ok: true, code: 'SENT', phrase: '开工' }).status, 'sent');
});

test('overlay stays visible after left click and supports three close controls', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '..', 'overlay.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  const mouseDownHandler = overlay.match(
    /document\.addEventListener\('mousedown',[\s\S]*?\n\}\);/u
  )?.[0] || '';
  assert.match(mouseDownHandler, /triggerCrackAnimation\(\)/u);
  assert.match(mouseDownHandler, /setTimeout\(\(\)\s*=>\s*\{/u);
  assert.match(mouseDownHandler, /window\.bridge\.whipCrack\(\)/u);
  assert.match(mouseDownHandler, /CRACK_SEND_DELAY_MS/u);
  assert.doesNotMatch(overlay, /document\.addEventListener\('mouseup'/u);
  assert.doesNotMatch(
    overlay,
    /window\.bridge\.whipCrack\(\)[\s\S]{0,120}dropping\s*=\s*true/u
  );
  assert.doesNotMatch(overlay, /LOCAL_SEND_COOLDOWN_MS|leftWhipPending|lastWhipRequestAt/u);
  assert.match(overlay, /function scheduleFrame\(\)/u);
  assert.match(overlay, /function getWhipBounds\(\)/u);
  assert.match(overlay, /AUDIO_BY_STYLE/u);
  assert.match(overlay, /mode === 'multi-tail'/u);
  assert.match(overlay, /function drawChain\(\)/u);
  assert.match(overlay, /function drawCyber\(\)/u);
  assert.match(overlay, /Math\.min\(6,/u);
  assert.doesNotMatch(overlay, /clearRect\(0,\s*0,\s*W,\s*H\)[\s\S]{0,160}requestAnimationFrame\(loop\)/u);
  assert.doesNotMatch(overlay, /^loop\(\);/mu);
  assert.match(overlay, /event\.button\s*===\s*2[\s\S]*?startDropping\(\)/u);
  assert.match(overlay, /TARGET_FRAME_INTERVAL_MS\s*=\s*1000\s*\/\s*30/u);
  assert.match(overlay, /constraintIters:\s*6/u);
  assert.match(overlay, /resetWhipState\(event\.clientX, event\.clientY\)/u);
  assert.match(overlay, /onRefreshWhip/u);
  assert.doesNotMatch(overlay, /desynchronized:\s*true/u);
  assert.match(preload, /ipcRenderer\.invoke\('whip-crack'\)/u);
  assert.match(preload, /onRefreshWhip/u);
  assert.match(main, /ipcMain\.handle\('whip-crack'/u);
  assert.match(main, /new WhipSendScheduler/u);
  assert.match(main, /已记下一鞭，上一句完成后自动发送/u);
  assert.match(main, /beforeDesktopSendFn:\s*lowerOverlayForDesktopSend/u);
  assert.match(main, /afterDesktopSendFn:\s*restoreOverlayAfterDesktopSend/u);
  assert.match(main, /setIgnoreMouseEvents\(true\)/u);
  assert.match(main, /setAlwaysOnTop\(false\)/u);
  assert.match(main, /setIgnoreMouseEvents\(false\)/u);
  assert.match(main, /webContents\.send\('refresh-whip', stylePayload/u);
  assert.match(main, /label: `鞭子款式：\$\{selectedStyleLabel\(\)\}`/u);
  assert.match(main, /settings\.json/u);
  assert.match(main, /resolveWhipStyle\(selectedWhipStyle\)/u);
  assert.match(main, /if \(!boundSession\) \{\s*await restoreSavedSession\(\);/u);
  assert.match(main, /globalShortcut\.register\('Escape', requestOverlayDrop\)/u);
  assert.match(main, /tray\.on\('click', toggleOverlay\)/u);
  assert.match(main, /ensureCodexSteerMode\(\)/u);
  assert.match(main, /跟进模式：直接发送/u);
  assert.doesNotMatch(main, /\bNotification\b|showDesktopNotification/u);
});

test('PowerShell helper verifies the exact target and proves delivery with new runtime ids', () => {
  const helper = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'codex-desktop-ui.ps1'),
    'utf8'
  );

  assert.match(helper, /sidebar-item/u);
  assert.match(helper, /TaskTitleMatchCount/u);
  assert.match(helper, /Test-ContainsAutomationElement/u);
  assert.match(helper, /AttachThreadInput/u);
  assert.match(helper, /BringWindowToTop/u);
  assert.match(helper, /AddMilliseconds\(1200\)/u);
  assert.match(helper, /\\bsteer\\b/u);
  assert.match(helper, /\$name -match '引导'/u);
  assert.match(helper, /Work with ChatGPT/u);
  assert.match(helper, /TargetTaskTitleBase64/u);
  assert.match(helper, /\$Mode -eq 'probe' -or \$hasTargetIdentity/u);
  assert.match(helper, /\$PreferredHwnd -gt 0/u);
  assert.match(helper, /\$Mode -eq 'send'/u);
  assert.doesNotMatch(helper, /\$Mode -eq 'write'/u);
  assert.doesNotMatch(helper, /\$Mode -eq 'commit'/u);
  assert.doesNotMatch(helper, /\$Mode -eq 'steer'/u);
  assert.match(helper, /SendUnicodeTextToWindow/u);
  assert.match(helper, /PressEnterToWindow/u);
  assert.match(helper, /GetForegroundWindow\(\) != expectedForeground/u);
  assert.match(helper, /Get-VerifiedCodexTarget/u);
  assert.match(helper, /Set-And-VerifyComposerFocus/u);
  assert.match(helper, /-RequireForeground/u);
  assert.match(helper, /-RequireFocus/u);
  assert.match(helper, /Get-RuntimeIdLookup/u);
  assert.match(helper, /Get-NewExactTextElements/u);
  assert.match(helper, /Test-IsSubmittedUserMessage/u);
  assert.match(helper, /Get-SteerActionsForText/u);
  assert.match(helper, /DELIVERY_AMBIGUOUS/u);
  assert.match(helper, /DELIVERY_UNCONFIRMED/u);
  assert.match(helper, /STEER_DELIVERY_UNCONFIRMED/u);
  assert.match(helper, /MESSAGE_DELIVERED/u);
  assert.doesNotMatch(helper, /ALREADY_STEERED/u);
  assert.match(helper, /\$valuePattern\.Current\.Value/u);
  assert.match(helper, /\$normalizedValue = \$currentValue\.Trim\(\)/u);
  assert.match(helper, /Test-ComposerPlaceholder -Name \$normalizedValue/u);
  assert.match(helper, /inputMethod/u);
  assert.match(helper, /draftVerification/u);
  assert.doesNotMatch(helper, /\$submitButton/u);
  assert.doesNotMatch(helper, /SUBMIT_BUTTON_NOT_FOUND/u);

  const sendBlock = helper.match(
    /if \(\$Mode -eq 'send'\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  if \(\$selected\.HasDraft\)/u
  )?.[1];
  assert.ok(sendBlock);
  const enterIndex = sendBlock.indexOf('PressEnterToWindow');
  const finalVerifyIndex = sendBlock.lastIndexOf('Get-VerifiedCodexTarget', enterIndex);
  assert.ok(finalVerifyIndex >= 0 && finalVerifyIndex < enterIndex);
});

test('PowerShell helper accepts migrated sidebar rows without trusting app tabs', () => {
  const helper = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'codex-desktop-ui.ps1'),
    'utf8'
  );

  assert.match(helper, /Get-CodexTaskCandidates/u);
  assert.match(helper, /SelectionItemPattern/u);
  assert.match(helper, /::ListItem/u);
  assert.match(helper, /::TreeItem/u);
  assert.match(helper, /app-action-sidebar-thread-selected/u);
  assert.match(helper, /sidebar\[-_ \]\?\(thread\|item\)/u);
  assert.match(helper, /Equal-score duplicates are treated as ambiguous/u);
  assert.match(helper, /::RadioButton/u);
  assert.match(helper, /Get-CodexActiveTaskTitles/u);
  assert.match(helper, /large, non-sidebar UIA/u);
});
