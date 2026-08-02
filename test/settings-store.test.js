const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  loadSettings,
  saveSettings,
} = require('../lib/settings-store');

function makeSettingsPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexwhip-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'settings.json');
}

test('missing settings use the leather whip', t => {
  const filePath = makeSettingsPath(t);
  assert.deepEqual(loadSettings(filePath), {
    ok: true,
    code: 'SETTINGS_DEFAULT',
    settings: { whipStyle: 'leather' },
  });
});

test('settings persist fixed and random modes', t => {
  const filePath = makeSettingsPath(t);
  assert.equal(saveSettings(filePath, { whipStyle: 'chain' }).ok, true);
  assert.equal(loadSettings(filePath).settings.whipStyle, 'chain');
  assert.equal(saveSettings(filePath, { whipStyle: 'random' }).ok, true);
  assert.equal(loadSettings(filePath).settings.whipStyle, 'random');
});

test('invalid JSON and unknown styles fall back without throwing', t => {
  const filePath = makeSettingsPath(t);
  fs.writeFileSync(filePath, '{ broken', 'utf8');
  assert.equal(loadSettings(filePath).code, 'SETTINGS_INVALID');
  fs.writeFileSync(filePath, '{"whipStyle":"mystery"}', 'utf8');
  assert.equal(loadSettings(filePath).settings.whipStyle, 'leather');
});

test('failed atomic replacement preserves the previous settings', t => {
  const filePath = makeSettingsPath(t);
  assert.equal(saveSettings(filePath, { whipStyle: 'crop' }).ok, true);

  const originalRename = fs.renameSync;
  fs.renameSync = function patchedRename(source, destination) {
    if (String(destination) === filePath) throw new Error('simulated rename failure');
    return originalRename.call(this, source, destination);
  };
  t.after(() => { fs.renameSync = originalRename; });

  assert.equal(saveSettings(filePath, { whipStyle: 'chain' }).ok, false);
  assert.equal(loadSettings(filePath).settings.whipStyle, 'crop');
});
