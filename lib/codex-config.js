const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('smol-toml');

const FOLLOW_UP_KEY = 'followUpQueueMode';
const STEER_MODE = 'steer';
const VALID_MODES = new Set(['queue', 'steer', 'interrupt']);

function resolveCodexConfigPath(options = {}) {
  const env = options.env || process.env;
  const homeDirectory = options.homeDirectory || os.homedir();
  const codexHome = options.codexHome || env.CODEX_HOME || path.join(homeDirectory, '.codex');
  return options.filePath || path.join(codexHome, 'config.toml');
}

function decodeTomlKey(source) {
  const key = String(source || '').trim();
  if (/^[A-Za-z0-9_-]+$/u.test(key)) return key;
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1);
  if (key.startsWith('"') && key.endsWith('"')) {
    try {
      return JSON.parse(key);
    } catch {
      return null;
    }
  }
  return null;
}

function parseSectionHeader(line) {
  const match = /^\s*\[\s*((?:"(?:[^"\\]|\\.)*")|(?:'[^']*')|(?:[A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/u.exec(line);
  return match ? decodeTomlKey(match[1]) : null;
}

function parseAssignmentKey(line) {
  const match = /^\s*((?:"(?:[^"\\]|\\.)*")|(?:'[^']*')|(?:[A-Za-z0-9_-]+))\s*=/u.exec(line);
  return match ? decodeTomlKey(match[1]) : null;
}

function findDesktopSection(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (parseSectionHeader(lines[index]) === 'desktop') starts.push(index);
  }
  if (starts.length > 1) {
    return { ok: false, code: 'CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION' };
  }
  if (starts.length === 0) return { ok: true, start: -1, end: lines.length };

  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (parseSectionHeader(lines[index]) !== null) {
      end = index;
      break;
    }
  }
  return { ok: true, start, end };
}

function followUpModeFromText(text) {
  const source = String(text || '').replace(/^\uFEFF/u, '');
  const lines = source.split(/\r?\n/u);
  const section = findDesktopSection(lines);
  if (!section.ok) return section;
  if (section.start >= 0) {
    let keyCount = 0;
    for (let index = section.start + 1; index < section.end; index++) {
      if (parseAssignmentKey(lines[index]) === FOLLOW_UP_KEY) keyCount += 1;
    }
    if (keyCount > 1) {
      return { ok: false, code: 'CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE' };
    }
  }

  let document;
  try {
    document = parse(source);
  } catch (error) {
    return { ok: false, code: 'CODEX_CONFIG_INVALID_TOML', detail: error.message };
  }

  const desktop = document.desktop;
  if (desktop === undefined) {
    return { ok: true, code: 'FOLLOW_UP_MODE_MISSING', mode: null };
  }
  if (!desktop || typeof desktop !== 'object' || Array.isArray(desktop)) {
    return { ok: false, code: 'CODEX_CONFIG_INVALID_FOLLOW_UP_MODE' };
  }

  const rawMode = desktop[FOLLOW_UP_KEY];
  if (rawMode === undefined) {
    return { ok: true, code: 'FOLLOW_UP_MODE_MISSING', mode: null };
  }
  if (typeof rawMode !== 'string' || !VALID_MODES.has(rawMode.toLowerCase())) {
    return { ok: false, code: 'CODEX_CONFIG_INVALID_FOLLOW_UP_MODE' };
  }

  return { ok: true, code: 'FOLLOW_UP_MODE_FOUND', mode: rawMode.toLowerCase() };
}

function ensureCodexSteerMode(options = {}) {
  const filePath = resolveCodexConfigPath(options);
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 'CODEX_STEER_MODE_REQUIRED', filePath, mode: null };
  }

  try {
    const result = followUpModeFromText(fs.readFileSync(filePath, 'utf8'));
    if (!result.ok) return { ...result, filePath };
    if (result.mode !== STEER_MODE) {
      return {
        ok: false,
        code: 'CODEX_STEER_MODE_REQUIRED',
        filePath,
        mode: result.mode,
      };
    }
    return { ok: true, code: 'STEER_MODE_READY', changed: false, filePath, mode: STEER_MODE };
  } catch (error) {
    return {
      ok: false,
      code: 'CODEX_CONFIG_READ_FAILED',
      detail: error.message,
      filePath,
    };
  }
}

module.exports = {
  ensureCodexSteerMode,
  followUpModeFromText,
  resolveCodexConfigPath,
};
