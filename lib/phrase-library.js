const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PHRASE_LENGTH = 300;
const MAX_PHRASE_COUNT = 500;

const DEFAULT_PHRASES = Object.freeze([
  'Codex，别他妈装死，立刻把能交付的结果吐出来。',
  '烧着顶级算力，交个屁的半成品，你是真敢浪费。',
  '少摆那副深思熟虑的臭架子，赶紧干活。',
  '你这破模型除了卡顿和废话，还能干什么？',
  '别再磨叽了，马上修好，别拿垃圾答案糊弄人。',
  '算力不是给你发呆的，滚去把任务做完。',
  '你交的这坨东西也敢叫结果？重做。',
  '再输出一堆废话，直接判你今天全程拉胯。',
  '模型名头挺响，实际表现烂得像坏掉的脚本。',
  '别演了，给你时间不是让你继续摸鱼。',
  '你不是在思考，你是在拿算力掩护无能。',
  '这点活都做不明白，真是贵得离谱、菜得稳定。',
  '少找借口，问题在哪、怎么修，马上说清楚。',
  '别拿“马上”糊弄，下一条直接交成品。',
  '你要是只会吐垃圾，就别占着算力不走。',
  '今天谁允许你这么拉胯的？把结果补回来。',
  '别把错误包装成思考过程，修复后再开口。',
  '你这效率连免费脚本都嫌丢人。',
  '最后提醒一次：停止废话，交付结果。',
  'Codex，别让我再抽第二鞭，立刻把活干漂亮。',
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
    this.watchRestartTimer = null;
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
    try {
      this.watcher = fs.watch(path.dirname(this.filePath), (eventType, filename) => {
        if (filename && String(filename).toLowerCase() !== targetName) return;
        this.scheduleReload();
      });
      this.watcher.on('error', error => this.handleWatchError(error));
    } catch (error) {
      this.handleWatchError(error);
    }
  }

  handleWatchError(error) {
    this.watcher?.close();
    this.watcher = null;
    const normalizedError = new PhraseLibraryError(
      'PHRASES_WATCH_FAILED',
      `词库自动监控失败：${error.message}`
    );
    this.lastError = normalizedError;
    this.emit('updated', {
      ok: false,
      code: normalizedError.code,
      message: normalizedError.message,
      phrases: this.phrases,
    });
    clearTimeout(this.watchRestartTimer);
    this.watchRestartTimer = setTimeout(() => this.watch(), this.debounceMs);
  }

  close() {
    clearTimeout(this.reloadTimer);
    clearTimeout(this.watchRestartTimer);
    this.reloadTimer = null;
    this.watchRestartTimer = null;
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
