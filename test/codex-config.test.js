const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ensureCodexSteerMode,
  followUpModeFromText,
  resolveCodexConfigPath,
} = require('../lib/codex-config');

function makeConfigPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexwhip-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, '.codex', 'config.toml');
}

test('structured TOML reading accepts bare, quoted, dotted and inline Steer settings', () => {
  assert.equal(followUpModeFromText('[desktop]\nfollowUpQueueMode = "steer"\n').mode, 'steer');
  assert.equal(followUpModeFromText('[desktop]\n"followUpQueueMode" = "steer"\n').mode, 'steer');
  assert.equal(followUpModeFromText('desktop.followUpQueueMode = "steer"\n').mode, 'steer');
  assert.equal(followUpModeFromText('desktop = { followUpQueueMode = "steer" }\n').mode, 'steer');
});

test('missing, Queue and legacy interrupt modes are reported without rewriting', () => {
  assert.equal(followUpModeFromText('model = "gpt-test"\n').mode, null);
  assert.equal(followUpModeFromText('[desktop]\nfollowUpQueueMode = "queue"\n').mode, 'queue');
  assert.equal(followUpModeFromText('[desktop]\nfollowUpQueueMode = "interrupt"\n').mode, 'interrupt');
});

test('duplicate settings and invalid TOML are rejected instead of guessed', () => {
  assert.equal(followUpModeFromText([
    '[desktop]',
    'followUpQueueMode = "queue"',
    'followUpQueueMode = "steer"',
  ].join('\n')).code, 'CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE');

  assert.equal(followUpModeFromText([
    '[desktop]',
    'followUpQueueMode = "queue"',
    '[desktop]',
    'followUpQueueMode = "steer"',
  ].join('\n')).code, 'CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION');

  assert.equal(
    followUpModeFromText('[desktop\nfollowUpQueueMode = "queue"\n').code,
    'CODEX_CONFIG_INVALID_TOML'
  );
});

test('ensureCodexSteerMode is read-only and requires the official Steer setting', t => {
  const filePath = makeConfigPath(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const queueSource = '[desktop]\n"followUpQueueMode" = "queue"\n';
  fs.writeFileSync(filePath, queueSource, 'utf8');

  const required = ensureCodexSteerMode({ filePath });
  assert.equal(required.ok, false);
  assert.equal(required.code, 'CODEX_STEER_MODE_REQUIRED');
  assert.equal(fs.readFileSync(filePath, 'utf8'), queueSource);

  const steerSource = '[desktop]\n"followUpQueueMode" = "steer"\n';
  fs.writeFileSync(filePath, steerSource, 'utf8');
  const ready = ensureCodexSteerMode({ filePath });
  assert.equal(ready.ok, true);
  assert.equal(ready.code, 'STEER_MODE_READY');
  assert.equal(ready.changed, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), steerSource);
});

test('missing config requires Steer without creating a file', t => {
  const filePath = makeConfigPath(t);
  const result = ensureCodexSteerMode({ filePath });
  assert.equal(result.code, 'CODEX_STEER_MODE_REQUIRED');
  assert.equal(fs.existsSync(filePath), false);
});

test('config path respects CODEX_HOME', () => {
  assert.equal(
    resolveCodexConfigPath({ env: { CODEX_HOME: 'D:\\CodexHome' }, homeDirectory: 'C:\\Users\\test' }),
    path.join('D:\\CodexHome', 'config.toml')
  );
});
