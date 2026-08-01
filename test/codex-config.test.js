const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ensureCodexSteerMode,
  followUpModeFromText,
  resolveCodexConfigPath,
  setFollowUpModeInText,
} = require('../lib/codex-config');

function makeConfigPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexwhip-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, '.codex', 'config.toml');
}

test('existing Queue setting is replaced with Steer without rewriting other settings', () => {
  const source = [
    'model = "gpt-test"',
    '',
    '[desktop]',
    'followUpQueueMode = "queue"',
    'appearanceTheme = "dark"',
    '',
    '[projects.test]',
    'trust_level = "trusted"',
    '',
  ].join('\r\n');
  const result = setFollowUpModeInText(source);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(result.content, /followUpQueueMode = "steer"\r\n/u);
  assert.match(result.content, /appearanceTheme = "dark"/u);
  assert.match(result.content, /\[projects\.test\]/u);
  assert.doesNotMatch(result.content, /followUpQueueMode = "queue"/u);
});

test('missing desktop setting or section is added explicitly', () => {
  const insideSection = setFollowUpModeInText('[desktop]\nappearanceTheme = "dark"\n');
  assert.match(insideSection.content, /\[desktop\]\nfollowUpQueueMode = "steer"\n/u);

  const missingSection = setFollowUpModeInText('model = "gpt-test"\n');
  assert.match(
    missingSection.content,
    /model = "gpt-test"\n\n\[desktop\]\nfollowUpQueueMode = "steer"\n$/u
  );
});

test('already enabled Steer is a no-op and legacy interrupt is normalized', () => {
  const ready = setFollowUpModeInText('[desktop]\nfollowUpQueueMode = "steer"\n');
  assert.equal(ready.changed, false);
  assert.equal(followUpModeFromText(ready.content).mode, 'steer');

  const legacy = setFollowUpModeInText('[desktop]\nfollowUpQueueMode = "interrupt"\n');
  assert.equal(legacy.changed, true);
  assert.equal(followUpModeFromText(legacy.content).mode, 'steer');
});

test('duplicate desktop settings are rejected instead of guessing', () => {
  assert.equal(setFollowUpModeInText([
    '[desktop]',
    'followUpQueueMode = "queue"',
    'followUpQueueMode = "steer"',
  ].join('\n')).code, 'CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE');

  assert.equal(setFollowUpModeInText([
    '[desktop]',
    'followUpQueueMode = "queue"',
    '[desktop]',
    'followUpQueueMode = "steer"',
  ].join('\n')).code, 'CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION');
});

test('ensureCodexSteerMode creates and atomically updates config.toml', t => {
  const filePath = makeConfigPath(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '[desktop]\nfollowUpQueueMode = "queue"\n', 'utf8');

  const updated = ensureCodexSteerMode({ filePath });
  assert.equal(updated.ok, true);
  assert.equal(updated.code, 'STEER_MODE_ENABLED');
  assert.equal(updated.changed, true);
  assert.equal(followUpModeFromText(fs.readFileSync(filePath, 'utf8')).mode, 'steer');

  const ready = ensureCodexSteerMode({ filePath });
  assert.equal(ready.code, 'STEER_MODE_READY');
  assert.equal(ready.changed, false);
});

test('config path respects CODEX_HOME', () => {
  assert.equal(
    resolveCodexConfigPath({ env: { CODEX_HOME: 'D:\\CodexHome' }, homeDirectory: 'C:\\Users\\test' }),
    path.join('D:\\CodexHome', 'config.toml')
  );
});
