const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '..', 'sounds');

function seededNoise(seedValue) {
  let seed = seedValue >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
}

function envelope(t, start, attack, decay) {
  if (t < start) return 0;
  const elapsed = t - start;
  if (elapsed < attack) return elapsed / Math.max(attack, 0.0001);
  return Math.exp(-(elapsed - attack) / Math.max(decay, 0.0001));
}

function softClip(value) {
  return Math.tanh(value * 1.35) * 0.82;
}

function makeSamples(duration, synth) {
  const count = Math.ceil(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    samples[index] = softClip(synth(index / SAMPLE_RATE, index));
  }
  return samples;
}

function writeWav(filePath, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index++) {
    buffer.writeInt16LE(Math.round(samples[index] * 32767), 44 + index * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function leather() {
  const noise = seededNoise(1401);
  return makeSamples(0.92, t => {
    const whoosh = noise() * envelope(t, 0, 0.12, 0.22) * (0.42 + Math.sin(t * 95) * 0.08);
    const snap = noise() * envelope(t, 0.31, 0.0015, 0.032) * 2.1;
    const body = Math.sin(Math.PI * 2 * 94 * t) * envelope(t, 0.305, 0.002, 0.11) * 0.72;
    return whoosh + snap + body;
  });
}

function flogger() {
  const noise = seededNoise(1403);
  const hits = [0.08, 0.104, 0.129, 0.158, 0.19];
  return makeSamples(0.78, t => {
    let value = noise() * envelope(t, 0, 0.14, 0.25) * 0.24;
    for (let index = 0; index < hits.length; index++) {
      value += noise() * envelope(t, hits[index], 0.0015, 0.045 + index * 0.006) * (0.66 - index * 0.06);
    }
    value += Math.sin(Math.PI * 2 * 72 * t) * envelope(t, 0.08, 0.006, 0.2) * 0.64;
    return value;
  });
}

function chain() {
  const noise = seededNoise(1404);
  const frequencies = [780, 1160, 1730, 2410];
  return makeSamples(1.05, t => {
    let value = noise() * envelope(t, 0.06, 0.001, 0.032) * 1.45;
    frequencies.forEach((frequency, index) => {
      value += Math.sin(Math.PI * 2 * frequency * t + index) * envelope(t, 0.055 + index * 0.006, 0.002, 0.22 + index * 0.08) * (0.5 - index * 0.07);
    });
    value += noise() * envelope(t, 0.22, 0.002, 0.07) * 0.36;
    return value;
  });
}

function cyber() {
  const noise = seededNoise(1405);
  return makeSamples(0.68, t => {
    const sweepFrequency = 180 + t * 1480;
    const sweep = Math.sin(Math.PI * 2 * sweepFrequency * t + Math.sin(t * 170) * 2.4)
      * envelope(t, 0.03, 0.008, 0.19) * 0.9;
    const zap = noise() * envelope(t, 0.12, 0.001, 0.045) * 1.7;
    const aftershock = Math.sign(Math.sin(Math.PI * 2 * 95 * t))
      * envelope(t, 0.18, 0.004, 0.14) * 0.34;
    return sweep + zap + aftershock;
  });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const sounds = {
  'leather.wav': leather(),
  'flogger.wav': flogger(),
  'chain.wav': chain(),
  'cyber.wav': cyber(),
};

for (const [fileName, samples] of Object.entries(sounds)) {
  writeWav(path.join(OUTPUT_DIR, fileName), samples);
}
