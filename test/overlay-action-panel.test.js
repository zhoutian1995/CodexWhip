const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const overlay = fs.readFileSync(path.join(ROOT, 'overlay.html'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('overlay exposes visible session and phrase actions', () => {
  assert.match(overlay, /id="actionPanel"/u);
  assert.match(overlay, /data-action="bind"/u);
  assert.match(overlay, /data-action="test"/u);
  assert.match(overlay, /data-action="phrases"/u);
  assert.match(overlay, /ACTION_BRIDGE_METHODS/u);
  assert.match(overlay, /window\.bridge\.onOverlayStatus/u);
  assert.match(overlay, /actionPanelMenu\.addEventListener\('click'/u);
});

test('preload and main wire the visible action panel to existing desktop actions', () => {
  assert.match(preload, /bindCurrentSession:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('bind-current-session'\)/u);
  assert.match(preload, /testCodexConnection:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('test-codex-connection'\)/u);
  assert.match(preload, /openPhraseLibrary:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('open-phrase-library'\)/u);
  assert.match(preload, /onOverlayStatus:/u);
  assert.match(main, /ipcMain\.handle\('bind-current-session'/u);
  assert.match(main, /ipcMain\.handle\('test-codex-connection'/u);
  assert.match(main, /ipcMain\.handle\('open-phrase-library'/u);
  assert.match(main, /overlay\.webContents\.send\('overlay-status'/u);
  assert.match(main, /code:\s*saved\.ok\s*\?\s*'SESSION_BOUND'/u);
  assert.match(main, /probeCodexForAction\(options = \{\}\)/u);
  assert.match(main, /lowerOverlayForDesktopSend\(\)/u);
  assert.match(main, /result\.code === 'ACCESSIBILITY_PERMISSION_REQUIRED'/u);
  assert.match(main, /code:\s*error\s*\?\s*'PHRASE_LIBRARY_OPEN_FAILED'/u);
  assert.match(main, /当前窗口没有 Codex 输入框/u);
  assert.match(main, /execFile\('\/usr\/bin\/open', \['-a', 'TextEdit'/u);
});
