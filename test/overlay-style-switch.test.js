const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const overlay = fs.readFileSync(path.join(ROOT, 'overlay.html'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('overlay exposes a discoverable stage-style switcher without stealing whip clicks', () => {
  assert.match(overlay, /id="styleSwitcher"/u);
  assert.match(overlay, /id="styleSwitcherToggle"/u);
  assert.match(overlay, /id="styleSwitcherMenu"[^>]*role="radiogroup"/u);
  assert.match(overlay, /data-style-id="leather"/u);
  assert.match(overlay, /data-style-id="flogger"/u);
  assert.match(overlay, /data-style-id="chain"/u);
  assert.match(overlay, /data-style-id="cyber"/u);
  assert.match(overlay, /data-style-id="random"/u);
  assert.match(overlay, /styleSwitcherMenu.addEventListener\('mousedown',\s*event\s*=>\s*event\.stopPropagation\(\)\)/u);
  assert.match(overlay, /styleSwitcherMenu.addEventListener\('click'/u);
  assert.match(overlay, /window\.bridge\.selectWhipStyle\(styleId\)/u);
  assert.match(overlay, /styleSwitcherPulse/u);
});

test('overlay tracks the selected style separately from the resolved random style', () => {
  assert.match(overlay, /selectedStyleId\s*=\s*payload\?\.selectedStyleId/u);
  assert.match(overlay, /selectedStyleId === 'random'/u);
  assert.match(overlay, /随机轮换 · \$\{resolvedLabel\}/u);
  assert.match(overlay, /setActiveStyle\(nextStyleId, payload\?\.style, selectedStyleId/u);
});

test('preload exposes the guarded style selection IPC request', () => {
  assert.match(preload, /selectWhipStyle:\s*\(styleId\)\s*=>\s*ipcRenderer\.invoke\('select-whip-style',\s*styleId\)/u);
  assert.match(main, /ipcMain\.handle\('select-whip-style'/u);
  assert.match(main, /selectedStyleId:\s*selectedWhipStyle/u);
  assert.match(main, /styleCatalog:\s*getStyleCatalog\(\)/u);
});

test('style selection refreshes a loaded overlay even when it is hidden', () => {
  assert.match(
    main,
    /if \(isOverlayUsable\(\) && overlayReady\) \{\s*overlay\.webContents\.send\('refresh-whip', stylePayload\(\{ respawn: true \}\)\);/u
  );
  assert.doesNotMatch(
    main,
    /if \(isOverlayVisible\(\) && overlayReady\) \{\s*overlay\.webContents\.send\('refresh-whip', stylePayload\(\{ respawn: true \}\)\);/u
  );
});
