const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_PHRASES,
  PhraseLibrary,
  choosePhrase,
  isChinesePhrase,
  parsePhraseJson,
} = require('../lib/phrase-library');

function makeTempLibrary(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexwhip-phrases-'));
  const library = new PhraseLibrary({
    filePath: path.join(directory, 'phrases.json'),
    debounceMs: 30,
    ...options,
  });
  t.after(() => {
    library.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return library;
}

test('first load creates a readable default Chinese phrase file', t => {
  const library = makeTempLibrary(t);
  const result = library.load();

  assert.equal(result.code, 'PHRASES_CREATED');
  assert.equal(result.phrases.length, DEFAULT_PHRASES.length);
  assert.ok(result.phrases.every(isChinesePhrase));
  assert.deepEqual(JSON.parse(fs.readFileSync(library.filePath, 'utf8')), DEFAULT_PHRASES);
});

test('parser trims blanks, removes duplicates and keeps Codex as the only English product name', () => {
  const phrases = parsePhraseJson(JSON.stringify([
    '  Codex，马上交补丁  ',
    '',
    '测试不绿不准总结',
    'Codex，马上交补丁',
  ]));
  assert.deepEqual(phrases, ['Codex，马上交补丁', '测试不绿不准总结']);
  assert.throws(
    () => parsePhraseJson('["GO FASTER"]'),
    error => error.code === 'PHRASE_NOT_CHINESE'
  );
});

test('invalid edits keep the last valid phrase list', t => {
  const library = makeTempLibrary(t);
  library.load();
  fs.writeFileSync(library.filePath, '["第一句", "第二句"]\n', 'utf8');
  assert.equal(library.load().ok, true);
  const previous = library.phrases;

  fs.writeFileSync(library.filePath, '{broken', 'utf8');
  const result = library.load();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PHRASES_JSON_INVALID');
  assert.equal(library.phrases, previous);
});

test('file watcher reloads a changed phrase file after debounce', async t => {
  const library = makeTempLibrary(t);
  library.load();
  library.watch();

  const updated = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('phrase watcher timed out')), 2000);
    library.on('updated', result => {
      if (result.ok && result.phrases.includes('周老板一声令下，补丁立刻交付')) {
        clearTimeout(timeout);
        resolve(result);
      }
    });
  });

  fs.writeFileSync(
    library.filePath,
    '["周老板一声令下，补丁立刻交付"]\n',
    'utf8'
  );
  const result = await updated;
  assert.deepEqual(result.phrases, ['周老板一声令下，补丁立刻交付']);
});

test('random selection covers both ends of a valid list', () => {
  const phrases = ['第一句', '第二句'];
  assert.equal(choosePhrase(phrases, () => 0), '第一句');
  assert.equal(choosePhrase(phrases, () => 0.999999), '第二句');
});
