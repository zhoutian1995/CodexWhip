const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getStyleCatalog } = require('../lib/whip-styles');

const ROOT = path.join(__dirname, '..');

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test('brand PNG assets use the expected production dimensions', () => {
  assert.deepEqual(readPngSize(path.join(ROOT, 'icon', 'CodexWhip-1024.png')), {
    width: 1024,
    height: 1024,
  });
  assert.deepEqual(readPngSize(path.join(ROOT, 'icon', 'Template.png')), {
    width: 512,
    height: 512,
  });
  assert.deepEqual(readPngSize(path.join(ROOT, 'assets', 'codexwhip-cover.png')), {
    width: 1536,
    height: 512,
  });
  assert.deepEqual(readPngSize(path.join(ROOT, 'assets', 'whip-styles.png')), {
    width: 1536,
    height: 600,
  });
});

test('Windows ICO contains all tray and installer sizes', () => {
  const buffer = fs.readFileSync(path.join(ROOT, 'icon', 'icon.ico'));
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  assert.equal(count, 5);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const width = buffer.readUInt8(6 + index * 16);
    sizes.push(width === 0 ? 256 : width);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 256]);
});

test('macOS ICNS exists and has a valid container header', () => {
  const icon = fs.readFileSync(path.join(ROOT, 'icon', 'icon.icns'));
  assert.equal(icon.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icon.readUInt32BE(4), icon.length);
  assert.ok(icon.length > 100_000);
});

test('four original WAV files are valid, distinct and referenced by styles', () => {
  const names = ['leather.wav', 'flogger.wav', 'chain.wav', 'cyber.wav'];
  const referencedNames = getStyleCatalog().flatMap(style => style.soundSources)
    .map(source => path.basename(source));
  assert.deepEqual(referencedNames, names);
  const hashes = names.map(name => {
    const buffer = fs.readFileSync(path.join(ROOT, 'sounds', name));
    assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(buffer.readUInt32LE(24), 44100);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  });
  assert.equal(new Set(hashes).size, 4);
});
