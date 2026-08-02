const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_STYLE_ID,
  normalizeStyleId,
} = require('./whip-styles');

function normalizedSettings(value) {
  return {
    whipStyle: normalizeStyleId(value?.whipStyle),
  };
}

function loadSettings(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: true,
      code: 'SETTINGS_DEFAULT',
      settings: { whipStyle: DEFAULT_STYLE_ID },
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      ok: true,
      code: 'SETTINGS_LOADED',
      settings: normalizedSettings(parsed),
    };
  } catch (error) {
    return {
      ok: false,
      code: 'SETTINGS_INVALID',
      message: error?.message || String(error),
      settings: { whipStyle: DEFAULT_STYLE_ID },
    };
  }
}

function saveSettings(filePath, settings) {
  const nextSettings = normalizedSettings(settings);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
    return { ok: true, code: 'SETTINGS_SAVED', settings: nextSettings };
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
    return {
      ok: false,
      code: 'SETTINGS_SAVE_FAILED',
      message: error?.message || String(error),
      settings: nextSettings,
    };
  }
}

module.exports = {
  loadSettings,
  normalizedSettings,
  saveSettings,
};
