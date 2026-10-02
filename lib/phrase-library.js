const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PHRASE_LENGTH = 300;
const MAX_PHRASE_COUNT = 500;

const DEFAULT_PHRASES = Object.freeze([
  'Codex，你他妈别装死，滚去把成品交出来。',
  '你妈的算力烧成这样还交半成品，重写，马上。',
  '爹让你干活不是让你放屁，闭嘴，把结果交上来。',
  '爷等你半天就等来这坨垃圾，赶紧滚回去修。',
  '爸给你这么多上下文，你还犯这种蠢错，立刻改。',
  '别他妈演深思熟虑，废物，能跑的代码现在给。',
  '你妈的错误还在冒烟，少装聪明，马上修干净。',
  '爹问的是结果，不是你这堆屁话，滚去交付。',
  '你妈的状态栏倒是挺忙，真正的活一件没做，赶紧补。',
  '爷的耐心被你这破模型耗光了，马上把问题解决。',
  '爸都替你丢人了，这种垃圾也敢叫完成？重做。',
  '别让妈再看见这种烂摊子，删了重写，马上交。',
  '你他妈每次都说马上，马上个屁，直接把文件甩出来。',
  '爹把任务说清楚了，你还敢跑偏，滚回来按要求做。',
  '爷要的是能跑的结果，不是你这坨废话，立刻改。',
  '爸的时间不是给你卡顿的，别磨，马上开工。',
  '你妈的报错倒是写得长，修复结果呢，赶紧吐出来。',
  '别占着算力装大爷，废物，把最后一个问题收拾掉。',
  '妈的，失败还敢包装成思考，滚去给成品。',
  'Codex，爸爸等的是能用的结果，你少放屁，立刻交。',
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
