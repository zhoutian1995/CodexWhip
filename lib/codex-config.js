const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FOLLOW_UP_KEY = 'followUpQueueMode';
const STEER_MODE = 'steer';

function resolveCodexConfigPath(options = {}) {
  const env = options.env || process.env;
  const homeDirectory = options.homeDirectory || os.homedir();
  const codexHome = options.codexHome || env.CODEX_HOME || path.join(homeDirectory, '.codex');
  return options.filePath || path.join(codexHome, 'config.toml');
}

function parseSectionHeader(line) {
  const match = /^\s*\[([^\[\]]+)]\s*(?:#.*)?$/.exec(line);
  return match ? match[1].trim() : null;
}

function findDesktopSection(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (parseSectionHeader(lines[index]) === 'desktop') starts.push(index);
  }

  if (starts.length > 1) {
    return { ok: false, code: 'CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION' };
  }
  if (starts.length === 0) {
    return { ok: true, start: -1, end: lines.length };
  }

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
  const content = String(text || '').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  const section = findDesktopSection(lines);
  if (!section.ok) return section;
  if (section.start < 0) {
    return { ok: true, code: 'FOLLOW_UP_MODE_MISSING', mode: null };
  }

  const matches = [];
  for (let index = section.start + 1; index < section.end; index++) {
    const match = /^\s*followUpQueueMode\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(lines[index]);
    if (match) matches.push(match[1].trim().toLowerCase());
  }
  if (matches.length > 1) {
    return { ok: false, code: 'CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE' };
  }
  if (matches.length === 0) {
    return { ok: true, code: 'FOLLOW_UP_MODE_MISSING', mode: null };
  }
  if (!['queue', 'steer', 'interrupt'].includes(matches[0])) {
    return { ok: false, code: 'CODEX_CONFIG_INVALID_FOLLOW_UP_MODE' };
  }

  return { ok: true, code: 'FOLLOW_UP_MODE_FOUND', mode: matches[0] };
}

function setFollowUpModeInText(text, mode = STEER_MODE) {
  if (!['queue', 'steer', 'interrupt'].includes(mode)) {
    return { ok: false, code: 'CODEX_CONFIG_INVALID_FOLLOW_UP_MODE' };
  }

  const source = String(text || '');
  const hasBom = source.startsWith('\uFEFF');
  const content = hasBom ? source.slice(1) : source;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  if (lines.length === 1 && lines[0] === '') lines.pop();

  const section = findDesktopSection(lines);
  if (!section.ok) return section;

  if (section.start < 0) {
    if (lines.length > 0 && lines.at(-1).trim() !== '') lines.push('');
    lines.push('[desktop]', `${FOLLOW_UP_KEY} = "${mode}"`);
  } else {
    const matches = [];
    for (let index = section.start + 1; index < section.end; index++) {
      if (/^\s*followUpQueueMode\s*=/.test(lines[index])) matches.push(index);
    }
    if (matches.length > 1) {
      return { ok: false, code: 'CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE' };
    }

    if (matches.length === 0) {
      lines.splice(section.start + 1, 0, `${FOLLOW_UP_KEY} = "${mode}"`);
    } else {
      const index = matches[0];
      const match = /^(\s*)followUpQueueMode\s*=\s*[^#]*(\s+#.*)?$/.exec(lines[index]);
      if (!match) {
        return { ok: false, code: 'CODEX_CONFIG_INVALID_FOLLOW_UP_MODE' };
      }
      lines[index] = `${match[1]}${FOLLOW_UP_KEY} = "${mode}"${match[2] || ''}`;
    }
  }

  const updatedContent = `${hasBom ? '\uFEFF' : ''}${lines.join(newline)}${lines.length > 0 ? newline : ''}`;
  const verification = followUpModeFromText(updatedContent);
  if (!verification.ok || verification.mode !== mode) {
    return { ok: false, code: 'CODEX_CONFIG_UPDATE_INVALID' };
  }

  return {
    ok: true,
    code: updatedContent === source ? 'STEER_MODE_READY' : 'STEER_MODE_UPDATE_NEEDED',
    changed: updatedContent !== source,
    content: updatedContent,
    mode,
  };
}

function sameFileVersion(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function ensureCodexSteerMode(options = {}) {
  const filePath = resolveCodexConfigPath(options);
  const maxAttempts = options.maxAttempts || 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const exists = fs.existsSync(filePath);
      const beforeStat = exists ? fs.statSync(filePath) : null;
      const source = exists ? fs.readFileSync(filePath, 'utf8') : '';
      const update = setFollowUpModeInText(source, STEER_MODE);
      if (!update.ok) return { ...update, filePath };
      if (!update.changed) {
        return { ok: true, code: 'STEER_MODE_READY', changed: false, filePath, mode: STEER_MODE };
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (beforeStat) {
        const currentStat = fs.statSync(filePath);
        if (!sameFileVersion(beforeStat, currentStat)) continue;
      } else if (fs.existsSync(filePath)) {
        continue;
      }

      const tempPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.codexwhip-${process.pid}-${Date.now()}.tmp`
      );
      try {
        fs.writeFileSync(tempPath, update.content, 'utf8');
        fs.renameSync(tempPath, filePath);
      } finally {
        fs.rmSync(tempPath, { force: true });
      }

      const verification = followUpModeFromText(fs.readFileSync(filePath, 'utf8'));
      if (verification.ok && verification.mode === STEER_MODE) {
        return { ok: true, code: 'STEER_MODE_ENABLED', changed: true, filePath, mode: STEER_MODE };
      }
    } catch (error) {
      return {
        ok: false,
        code: 'CODEX_CONFIG_UPDATE_FAILED',
        detail: error.message,
        filePath,
      };
    }
  }

  return { ok: false, code: 'CODEX_CONFIG_CHANGED_DURING_UPDATE', filePath };
}

module.exports = {
  ensureCodexSteerMode,
  followUpModeFromText,
  resolveCodexConfigPath,
  setFollowUpModeInText,
};
