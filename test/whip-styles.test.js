const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_STYLE_ID,
  FIXED_STYLE_IDS,
  getStyleCatalog,
  normalizeStyleId,
  resolveWhipStyle,
} = require('../lib/whip-styles');

test('style registry exposes five public styles with unique audio', () => {
  const catalog = getStyleCatalog();
  assert.equal(catalog.length, 5);
  assert.deepEqual(catalog.map(style => style.id), [
    'leather',
    'crop',
    'flogger',
    'chain',
    'cyber',
  ]);
  assert.equal(new Set(catalog.flatMap(style => style.soundSources)).size, 5);
});

test('unknown settings fall back to the leather whip', () => {
  assert.equal(normalizeStyleId('unknown'), DEFAULT_STYLE_ID);
  assert.equal(normalizeStyleId(null), DEFAULT_STYLE_ID);
  assert.equal(resolveWhipStyle('unknown'), DEFAULT_STYLE_ID);
});

test('random mode resolves predictably and stays inside fixed styles', () => {
  assert.equal(resolveWhipStyle('random', () => 0), FIXED_STYLE_IDS[0]);
  assert.equal(resolveWhipStyle('random', () => 0.999999), FIXED_STYLE_IDS.at(-1));
  assert.equal(resolveWhipStyle('random', () => Number.NaN), FIXED_STYLE_IDS[0]);
});
