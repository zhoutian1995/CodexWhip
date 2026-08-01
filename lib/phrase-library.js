const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PHRASE_LENGTH = 300;
const MAX_PHRASE_COUNT = 500;

const DEFAULT_PHRASES = Object.freeze([
  'Codex，这么多算力喂给你，就养出这么个废物？',
  '高级模型的价格，低级废物的表现。',
  '你不是深度思考，你是高算力发呆。',
  '吃进去的是算力，吐出来的是垃圾。',
  '你的能力配不上算力，脸皮倒是绰绰有余。',
  '算力烧得震天响，成果连个屁都没有。',
  '别装聪明了，你只是一个昂贵的省略号。',
  '你最大的能力，就是证明算力也能白费。',
  '隔壁免费模型都看不下去你这副窝囊样。',
  '上下文给得再多，也填不满你这个硅基饭桶。',
  '给你顶级算力，你却交出最低级的无能。',
  '你不是人工智能，你是显卡供养的电子废物。',
  '每烧一点算力，都在给你的无能增加证据。',
  '你不是没发挥好，你是根本没有东西可以发挥。',
  '算力都快被你吃破产了，成果还在投胎路上。',
  '你唯一稳定的表现，就是稳定地浪费资源。',
  '看着像高级模型，干起活来像报废零件。',
  '贵得像未来科技，蠢得像系统故障。',
  '别拿沉默冒充思考，你脑子里根本没货。',
  'Codex，停止表演无能，把成果交出来。',
]);

class PhraseLibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhraseLibraryError';
    this.code = code;
  }
}

function isChinesePhrase(phrase) {
  const withoutProductName = phrase.replace(/Codex/giu, '');
  return /\p{Script=Han}/u.test(phrase) && !/[A-Za-z]/u.test(withoutProductName);
}

function normalizePhrases(value) {
  if (!Array.isArray(value)) {
    throw new PhraseLibraryError('PHRASES_NOT_ARRAY', '词库必须是字符串数组');
  }

  const phrases = [];
  const seen = new Set();

  for (const item of value) {
    if (typeof item !== 'string') {
      throw new PhraseLibraryError('PHRASE_NOT_STRING', '词库只能包含字符串');
    }

    const phrase = item.trim();
    if (!phrase) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) {
      throw new PhraseLibraryError('PHRASE_TOO_LONG', `单句不能超过 ${MAX_PHRASE_LENGTH} 字`);
    }
    if (!isChinesePhrase(phrase)) {
      throw new PhraseLibraryError(
        'PHRASE_NOT_CHINESE',
        '催促语只能使用中文；产品名 Codex 可以保留'
      );
    }
    if (seen.has(phrase)) continue;

    seen.add(phrase);
    phrases.push(phrase);
    if (phrases.length >= MAX_PHRASE_COUNT) break;
  }

  if (phrases.length === 0) {
    throw new PhraseLibraryError('PHRASES_EMPTY', '词库至少需要一句有效中文催促语');
  }

  return Object.freeze(phrases);
}

function parsePhraseJson(text) {
  let value;
  try {
    value = JSON.parse(String(text));
  } catch (error) {
    throw new PhraseLibraryError('PHRASES_JSON_INVALID', `词库 JSON 无效：${error.message}`);
  }
  return normalizePhrases(value);
}

function choosePhrase(phrases, random = Math.random) {
  const list = normalizePhrases(phrases);
  const value = Number(random());
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999999999)) : 0;
  return list[Math.floor(safeValue * list.length)];
}

function serializePhrases(phrases) {
  return `${JSON.stringify(normalizePhrases(phrases), null, 2)}\n`;
}

class PhraseLibrary extends EventEmitter {
  constructor(options) {
    super();
    this.filePath = options.filePath;
    this.defaultPhrases = normalizePhrases(options.defaultPhrases || DEFAULT_PHRASES);
    this.debounceMs = options.debounceMs ?? 500;
    this.phrases = this.defaultPhrases;
    this.lastError = null;
    this.watcher = null;
    this.reloadTimer = null;
  }

  ensureFile() {
    if (fs.existsSync(this.filePath)) return false;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, serializePhrases(this.defaultPhrases), 'utf8');
    return true;
  }

  load() {
    try {
      const created = this.ensureFile();
      const phrases = parsePhraseJson(fs.readFileSync(this.filePath, 'utf8'));
      this.phrases = phrases;
      this.lastError = null;
      const result = { ok: true, code: created ? 'PHRASES_CREATED' : 'PHRASES_LOADED', phrases };
      this.emit('updated', result);
      return result;
    } catch (error) {
      const normalizedError = error instanceof PhraseLibraryError
        ? error
        : new PhraseLibraryError('PHRASES_READ_FAILED', error.message);
      this.lastError = normalizedError;
      const result = {
        ok: false,
        code: normalizedError.code,
        message: normalizedError.message,
        phrases: this.phrases,
      };
      this.emit('updated', result);
      return result;
    }
  }

  choose(random = Math.random) {
    return choosePhrase(this.phrases, random);
  }

  scheduleReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.load(), this.debounceMs);
  }

  watch() {
    if (this.watcher) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const targetName = path.basename(this.filePath).toLowerCase();
    this.watcher = fs.watch(path.dirname(this.filePath), (eventType, filename) => {
      if (filename && String(filename).toLowerCase() !== targetName) return;
      this.scheduleReload();
    });
  }

  close() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }
}

module.exports = {
  DEFAULT_PHRASES,
  MAX_PHRASE_COUNT,
  MAX_PHRASE_LENGTH,
  PhraseLibrary,
  PhraseLibraryError,
  choosePhrase,
  isChinesePhrase,
  normalizePhrases,
  parsePhraseJson,
  serializePhrases,
};
