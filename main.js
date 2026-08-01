const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  messageForResult,
  probeCodexDesktop,
  sendWhipMessage,
} = require('./lib/codex-desktop-windows');
const {
  clearBinding,
  loadBinding,
  restoreBinding,
  saveBinding,
} = require('./lib/binding-store');
const {
  DEFAULT_PHRASES,
  PhraseLibrary,
} = require('./lib/phrase-library');
const { responseForResult } = require('./lib/whip-response');
const { ensureCodexSteerMode } = require('./lib/codex-config');

let tray;
let overlay;
let overlayReady = false;
let spawnQueued = false;
let sendInFlight = false;
let lastSendAt = 0;
let revealOverlayOnReady = false;
let boundSession = null;
let trayStatus = '未绑定任务';
let phraseLibrary = null;
let phraseFilePath = '';
let bindingFilePath = '';
let dropHideTimer = null;
let escapeRegistered = false;
let steerModeReady = false;

const SEND_COOLDOWN_MS = 1500;
const DROP_HIDE_TIMEOUT_MS = 1800;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const STATUS_MESSAGES = Object.freeze({
  APP_NOT_RUNNING: 'Codex Desktop 未启动',
  CODEX_MODE_NOT_FOUND: '当前不是 Codex 模式',
  COMPOSER_NOT_FOUND: '没有找到 Codex 输入框',
  AMBIGUOUS_WINDOWS: '存在多个 Codex 窗口，无法确定目标',
  TARGET_SESSION_REQUIRED: '请先绑定 Codex 任务',
  TARGET_SESSION_MISMATCH: '当前不是已绑定任务，本次未发送',
  TARGET_WINDOW_NOT_ACTIVE: '绑定窗口已失去前台焦点，本次未发送',
  TASK_ID_NOT_FOUND: '无法识别当前 Codex 任务',
  DRAFT_PRESENT: '目标任务有未发送草稿，本次未发送',
  COMPOSER_CHANGED: 'Codex 输入框发生变化，本次未发送',
  FOCUS_FAILED: '无法确认焦点仍在绑定任务输入框，本次未发送',
  DELIVERY_AMBIGUOUS: '检测到多个新消息候选，已停止猜测',
  DELIVERY_UNCONFIRMED: '无法证明消息已进入绑定任务',
  STEER_DELIVERY_UNCONFIRMED: '已触发引导，但无法确认消息完成投递',
  ACCESS_DENIED: 'CodexWhip 与 Codex 权限等级不一致',
  DUPLICATE_TASK_TITLE: '存在同名任务，无法安全恢复绑定',
  TASK_TITLE_UNVERIFIED: '无法确认任务标题唯一，请重新绑定',
  QUEUED_MESSAGE_STEER_FAILED: '消息已排队，自动引导失败',
  STEER_INVOKE_UNAVAILABLE: '消息已排队，但引导按钮暂不可用',
  CODEX_CONFIG_UPDATE_FAILED: '无法把 Codex 跟进模式设为直接引导',
  CODEX_CONFIG_CHANGED_DURING_UPDATE: 'Codex 设置正在变化，请再抽一次',
  CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION: 'Codex 配置存在重复 desktop 段',
  CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE: 'Codex 配置存在重复跟进行为',
  CODEX_CONFIG_INVALID_FOLLOW_UP_MODE: 'Codex 跟进行为配置无效',
  CODEX_CONFIG_INVALID_TOML: 'Codex 配置文件不是有效 TOML，本次未修改',
  CODEX_CONFIG_READ_FAILED: '无法读取 Codex 配置文件',
  CODEX_STEER_MODE_REQUIRED: '请先在 Codex 设置中把跟进行为设为 Steer',
  CODEX_CONFIG_UPDATE_INVALID: '无法确认 Codex 已启用直接引导',
});

function createTrayIconFallback() {
  const iconPath = path.join(__dirname, 'icon', 'Template.png');
  if (fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image;
  }
  console.warn('codexwhip: icon/Template.png missing or invalid');
  return nativeImage.createEmpty();
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'icon', 'icon.ico');
  if (fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image;
  }
  return createTrayIconFallback();
}

function shorten(value, maxLength = 32) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function statusForResult(result) {
  if (!result) return '未知错误';
  const base = STATUS_MESSAGES[result.code] || messageForResult(result) || result.code;
  if (result.code === 'TARGET_SESSION_MISMATCH' && result.currentTaskTitle) {
    return `${base}：${shorten(result.currentTaskTitle, 20)}`;
  }
  return base;
}

function isOverlayVisible() {
  return isOverlayUsable() && overlay.isVisible();
}

function refreshTrayMenu() {
  if (!tray) return;

  const targetLabel = boundSession
    ? `已绑定：${shorten(boundSession.taskTitle)}`
    : '未绑定任务';
  tray.setToolTip(`CodexWhip - ${targetLabel}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isOverlayVisible() ? '收起鞭子' : '召唤鞭子',
        click: toggleOverlay,
      },
      { label: '绑定当前 Codex 任务', click: bindCurrentSession },
      { label: targetLabel, enabled: false },
      { label: '解除绑定', enabled: Boolean(boundSession), click: clearBoundSession },
      { type: 'separator' },
      { label: '测试当前绑定', click: testCodexConnection },
      { label: steerModeReady ? '跟进模式：直接发送' : '跟进模式：等待修复', enabled: false },
      { type: 'separator' },
      { label: '打开中文催促词库', click: openPhraseLibrary },
      { label: '重新加载词库', click: reloadPhraseLibrary },
      { label: `状态：${shorten(trayStatus, 42)}`, enabled: false },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
}

function setTrayStatus(status) {
  trayStatus = status;
  console.log(`codexwhip: status: ${status}`);
  refreshTrayMenu();
}

function sessionFromProbe(result) {
  return {
    hwnd: result.hwnd,
    processId: result.processId,
    taskTitle: result.taskTitle,
    taskRuntimeId: result.taskRuntimeId,
  };
}

async function bindCurrentSession() {
  const result = await probeCodexDesktop();
  if (!result.ok) {
    setTrayStatus(`绑定失败：${statusForResult(result)}`);
    return;
  }
  if (!result.taskTitle || !result.taskRuntimeId) {
    setTrayStatus('绑定失败：无法识别当前 Codex 任务');
    return;
  }

  boundSession = sessionFromProbe(result);
  const saved = saveBinding(bindingFilePath, result.taskTitle);
  setTrayStatus(saved.ok
    ? `已绑定：${result.taskTitle}`
    : `已绑定，但保存失败：${result.taskTitle}`);
}

function clearBoundSession() {
  boundSession = null;
  const result = clearBinding(bindingFilePath);
  setTrayStatus(result.ok ? '已解除绑定' : '绑定已解除，但记忆文件删除失败');
}

async function restoreSavedSession() {
  const saved = loadBinding(bindingFilePath);
  if (!saved.ok) {
    setTrayStatus(saved.code === 'BINDING_NOT_FOUND' ? '未绑定任务' : '绑定记忆无效，请重新绑定');
    return;
  }

  const probeResult = await probeCodexDesktop({ targetTaskTitle: saved.taskTitle });
  const restored = restoreBinding(saved.taskTitle, probeResult);
  if (!restored.ok) {
    setTrayStatus(`记忆绑定未恢复：${statusForResult(restored)}`);
    return;
  }

  boundSession = restored.binding;
  setTrayStatus(`已自动恢复：${boundSession.taskTitle}`);
}

async function testCodexConnection() {
  if (!boundSession) {
    setTrayStatus('请先绑定 Codex 任务');
    return;
  }

  const result = await probeCodexDesktop({
    preferredHwnd: boundSession.hwnd,
    targetTaskTitle: boundSession.taskTitle,
    targetTaskRuntimeId: boundSession.taskRuntimeId,
  });
  if (!result.ok) {
    setTrayStatus(`连接失败：${statusForResult(result)}`);
    return;
  }

  boundSession.hwnd = result.hwnd;
  boundSession.processId = result.processId;
  setTrayStatus(result.hasDraft ? '连接正常，但目标任务有草稿' : '连接正常，可以连续抽打');
}

function initializePhraseLibrary() {
  phraseLibrary = new PhraseLibrary({ filePath: phraseFilePath });
  const initialResult = phraseLibrary.load();
  phraseLibrary.on('updated', result => {
    if (!tray) return;
    if (result.ok) {
      setTrayStatus(`中文词库已加载：${result.phrases.length} 句`);
    } else {
      setTrayStatus(`词库无效，继续使用上次版本：${result.message}`);
    }
  });
  phraseLibrary.watch();
  return initialResult;
}

async function openPhraseLibrary() {
  const error = await shell.openPath(phraseFilePath);
  setTrayStatus(error ? `打开词库失败：${error}` : '已打开中文催促词库');
}

function reloadPhraseLibrary() {
  phraseLibrary?.load();
}

function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlayReady = false;
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (spawnQueued && isOverlayVisible()) {
      spawnQueued = false;
      overlay.webContents.send('spawn-whip');
    }
  });
  overlay.on('show', refreshTrayMenu);
  overlay.on('hide', () => {
    unregisterEscapeShortcut();
    refreshTrayMenu();
  });
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
    unregisterEscapeShortcut();
  });
  overlay.loadFile('overlay.html');
}

function isOverlayUsable() {
  return Boolean(
    overlay &&
    !overlay.isDestroyed() &&
    overlay.webContents &&
    !overlay.webContents.isDestroyed()
  );
}

function registerEscapeShortcut() {
  if (escapeRegistered) return;
  escapeRegistered = globalShortcut.register('Escape', requestOverlayDrop);
  if (!escapeRegistered) setTrayStatus('鞭子已显示，但 Esc 快捷键注册失败');
}

function unregisterEscapeShortcut() {
  if (!escapeRegistered) return;
  globalShortcut.unregister('Escape');
  escapeRegistered = false;
}

function hideOverlay() {
  clearTimeout(dropHideTimer);
  dropHideTimer = null;
  if (isOverlayUsable()) overlay.hide();
  unregisterEscapeShortcut();
  refreshTrayMenu();
}

function requestOverlayDrop() {
  if (!isOverlayVisible()) return;
  overlay.webContents.send('drop-whip');
  clearTimeout(dropHideTimer);
  dropHideTimer = setTimeout(hideOverlay, DROP_HIDE_TIMEOUT_MS);
}

function toggleOverlay() {
  if (isOverlayVisible()) {
    requestOverlayDrop();
    return;
  }
  revealOverlay();
}

function revealOverlay() {
  clearTimeout(dropHideTimer);
  dropHideTimer = null;
  if (!isOverlayUsable()) createOverlay();
  if (!isOverlayUsable()) return;

  overlay.show();
  registerEscapeShortcut();
  if (overlayReady) {
    overlay.webContents.send('spawn-whip');
  } else {
    spawnQueued = true;
  }
  refreshTrayMenu();
}

async function lowerOverlayForDesktopSend() {
  if (!isOverlayVisible()) return;
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(false);
  await new Promise(resolve => setTimeout(resolve, 80));
}

function restoreOverlayAfterDesktopSend() {
  if (!isOverlayUsable()) return;
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(false);
  if (overlay.isVisible()) {
    overlay.showInactive();
    setTimeout(() => {
      if (isOverlayVisible() && overlayReady) {
        overlay.webContents.send('refresh-whip');
      }
    }, 80);
  }
}

ipcMain.handle('whip-crack', async () => {
  const now = Date.now();
  if (sendInFlight || now - lastSendAt < SEND_COOLDOWN_MS) {
    return {
      status: 'cooldown',
      retryAfterMs: Math.max(0, SEND_COOLDOWN_MS - (now - lastSendAt)),
    };
  }
  if (!boundSession) {
    await restoreSavedSession();
  }
  if (!boundSession) {
    setTrayStatus('请先绑定 Codex 任务');
    return { status: 'unbound', code: 'TARGET_SESSION_REQUIRED' };
  }

  sendInFlight = true;
  lastSendAt = now;
  try {
    const phrase = phraseLibrary?.choose() || DEFAULT_PHRASES[0];
    const result = await sendWhipMessage({
      phrase,
      preferredHwnd: boundSession.hwnd,
      targetTaskTitle: boundSession.taskTitle,
      targetTaskRuntimeId: boundSession.taskRuntimeId,
      beforeDesktopSendFn: lowerOverlayForDesktopSend,
      afterDesktopSendFn: restoreOverlayAfterDesktopSend,
    });
    if (!result.ok) {
      if (result.code?.startsWith('CODEX_CONFIG_')) steerModeReady = false;
      setTrayStatus(statusForResult(result));
      return responseForResult(result);
    }

    steerModeReady = true;
    boundSession.hwnd = result.hwnd;
    boundSession.processId = result.processId;
    console.log(`codexwhip: sent "${result.phrase}" to Codex Desktop`);
    setTrayStatus(`已发送：${result.phrase}`);
    return responseForResult(result);
  } catch (error) {
    console.warn('codexwhip: desktop send failed:', error?.message || error);
    setTrayStatus('发送失败：桌面自动化异常');
    return { status: 'failed', code: 'DESKTOP_AUTOMATION_FAILED' };
  } finally {
    sendInFlight = false;
  }
});

ipcMain.on('hide-overlay', hideOverlay);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady() || !tray) {
      revealOverlayOnReady = true;
      return;
    }

    setTimeout(() => {
      try {
        revealOverlay();
      } catch (error) {
        console.warn('codexwhip: could not reveal existing instance:', error?.message || error);
      }
    }, 100);
  });

  app.whenReady().then(async () => {
    if (process.platform !== 'win32') {
      console.warn('codexwhip: CodexWhip Desktop currently supports Windows only.');
      app.quit();
      return;
    }

    app.setAppUserModelId('com.weiling.codexwhip');
    const steerModeResult = ensureCodexSteerMode();
    steerModeReady = steerModeResult.ok;
    const storageDir = path.join(app.getPath('appData'), 'codexwhip');
    phraseFilePath = path.join(storageDir, 'phrases.json');
    bindingFilePath = path.join(storageDir, 'binding.json');
    const phraseResult = initializePhraseLibrary();

    tray = new Tray(getTrayIcon());
    refreshTrayMenu();
    tray.on('click', toggleOverlay);

    await restoreSavedSession();
    if (!steerModeResult.ok) {
      setTrayStatus(`直接发送未启用：${statusForResult(steerModeResult)}`);
    }
    if (!phraseResult.ok) {
      setTrayStatus(`词库无效，继续使用默认中文词库：${phraseResult.message}`);
    }

    revealOverlay();
    if (revealOverlayOnReady) {
      revealOverlayOnReady = false;
      revealOverlay();
    }
  });
}

app.on('will-quit', () => {
  clearTimeout(dropHideTimer);
  phraseLibrary?.close();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', event => event.preventDefault());
