const DEFAULT_STYLE_ID = 'leather';
const RANDOM_STYLE_ID = 'random';

const WHIP_STYLES = Object.freeze({
  leather: Object.freeze({
    id: 'leather',
    label: '黑红长皮鞭',
    physicsMode: 'rope',
    soundSources: Object.freeze(['sounds/leather.wav']),
    physics: Object.freeze({
      segments: 28,
      segmentLength: 23,
      taper: 0.54,
      gravity: 1.05,
      dropGravity: 0.95,
      damping: 0.962,
      constraintIters: 6,
      maxStretchRatio: 1.18,
      baseTargetAngle: -1.08,
      handleSpring: 0.68,
      handleAngularDamping: 0.082,
      handleMaxBendDeg: 14,
      tipMaxBendDeg: 142,
      arcWidth: 300,
      arcHeight: 205,
    }),
    visual: Object.freeze({
      core: '#08090b',
      edge: '#31060d',
      highlight: '#b2182b',
      metal: '#c9cdd2',
      handleWidth: 16,
      tipWidth: 4,
      glow: 0,
    }),
  }),
  flogger: Object.freeze({
    id: 'flogger',
    label: '七尾多尾鞭',
    physicsMode: 'multi-tail',
    soundSources: Object.freeze(['sounds/flogger.wav']),
    physics: Object.freeze({
      tails: 7,
      segments: 13,
      segmentLength: 18,
      taper: 0.72,
      gravity: 1.18,
      dropGravity: 1,
      damping: 0.947,
      constraintIters: 4,
      maxStretchRatio: 1.16,
      baseTargetAngle: -1.18,
      handleSpring: 0.72,
      handleAngularDamping: 0.09,
      handleMaxBendDeg: 24,
      tipMaxBendDeg: 150,
      arcWidth: 230,
      arcHeight: 175,
    }),
    visual: Object.freeze({
      core: '#0b090b',
      edge: '#3b0710',
      highlight: '#9e1425',
      metal: '#bdc2c8',
      handleWidth: 20,
      tipWidth: 4,
      glow: 0,
    }),
  }),
  chain: Object.freeze({
    id: 'chain',
    label: '银黑锁链鞭',
    physicsMode: 'chain',
    soundSources: Object.freeze(['sounds/chain.wav']),
    physics: Object.freeze({
      segments: 18,
      segmentLength: 25,
      taper: 0.94,
      gravity: 1.48,
      dropGravity: 1.22,
      damping: 0.938,
      constraintIters: 7,
      maxStretchRatio: 1.08,
      baseTargetAngle: -1.02,
      handleSpring: 0.62,
      handleAngularDamping: 0.072,
      handleMaxBendDeg: 28,
      tipMaxBendDeg: 118,
      arcWidth: 275,
      arcHeight: 165,
    }),
    visual: Object.freeze({
      core: '#111318',
      edge: '#050608',
      highlight: '#f1f3f5',
      metal: '#b8bec6',
      handleWidth: 19,
      tipWidth: 11,
      glow: 0,
    }),
  }),
  cyber: Object.freeze({
    id: 'cyber',
    label: '赛博高压电缆鞭',
    physicsMode: 'rope',
    soundSources: Object.freeze(['sounds/cyber.wav']),
    physics: Object.freeze({
      segments: 22,
      segmentLength: 27,
      taper: 0.76,
      gravity: 0.92,
      dropGravity: 0.92,
      damping: 0.956,
      constraintIters: 6,
      maxStretchRatio: 1.14,
      baseTargetAngle: -1.14,
      handleSpring: 0.76,
      handleAngularDamping: 0.088,
      handleMaxBendDeg: 18,
      tipMaxBendDeg: 132,
      arcWidth: 285,
      arcHeight: 190,
    }),
    visual: Object.freeze({
      core: '#05070a',
      edge: '#3c0711',
      highlight: '#ff304b',
      metal: '#8f9aa5',
      handleWidth: 17,
      tipWidth: 7,
      glow: 14,
    }),
  }),
});

const FIXED_STYLE_IDS = Object.freeze(Object.keys(WHIP_STYLES));
const SELECTABLE_STYLE_IDS = Object.freeze([...FIXED_STYLE_IDS, RANDOM_STYLE_ID]);

function isFixedStyleId(value) {
  return typeof value === 'string' && Object.hasOwn(WHIP_STYLES, value);
}

function isSelectableStyleId(value) {
  return value === RANDOM_STYLE_ID || isFixedStyleId(value);
}

function normalizeStyleId(value) {
  return isSelectableStyleId(value) ? value : DEFAULT_STYLE_ID;
}

function resolveWhipStyle(value, random = Math.random) {
  const selected = normalizeStyleId(value);
  if (selected !== RANDOM_STYLE_ID) return selected;
  const sample = Number(random());
  const bounded = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0;
  return FIXED_STYLE_IDS[Math.floor(bounded * FIXED_STYLE_IDS.length)];
}

function getStyleCatalog() {
  return FIXED_STYLE_IDS.map(id => WHIP_STYLES[id]);
}

module.exports = {
  DEFAULT_STYLE_ID,
  FIXED_STYLE_IDS,
  RANDOM_STYLE_ID,
  SELECTABLE_STYLE_IDS,
  WHIP_STYLES,
  getStyleCatalog,
  isFixedStyleId,
  isSelectableStyleId,
  normalizeStyleId,
  resolveWhipStyle,
};
