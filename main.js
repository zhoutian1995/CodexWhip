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
  systemPreferences,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  messageForResult,
  probeCodexDesktop,
  sendWhipMessage,
} = require('./lib/codex-desktop');
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
const {
  DEFAULT_STYLE_ID,
  RANDOM_STYLE_ID,
  WHIP_STYLES,
  getStyleCatalog,
  resolveWhipStyle,
} = require('./lib/whip-styles');
const { loadSettings, saveSettings } = require('./lib/settings-store');
const { WhipSendScheduler } = require('./lib/whip-send-scheduler');

let tray;
let overlay;
let overlayReady = false;
let spawnQueued = false;
let whipSendScheduler = null;
let revealOverlayOnReady = false;
let boundSession = null;
let trayStatus = '未绑定任务';
let phraseLibrary = null;
let phraseFilePath = '';
let bindingFilePath = '';
let settingsFilePath = '';
let dropHideTimer = null;
let escapeRegistered = false;
let steerModeReady = false;
let selectedWhipStyle = DEFAULT_STYLE_ID;
let activeWhipStyle = DEFAULT_STYLE_ID;
let overlayHiddenForDesktopSend = false;

const SEND_COOLDOWN_MS = 1500;
const DROP_HIDE_TIMEOUT_MS = 1800;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const STATUS_MESSAGES = Object.freeze({
  APP_NOT_RUNNING: 'Codex Desktop 未启动',
  ACCESSIBILITY_PERMISSION_REQUIRED: '请在 macOS 设置中允许 CodexWhip 使用辅助功能',
  CODEX_MODE_NOT_FOUND: '当前窗口没有 Codex 输入框，请先打开一个 Codex 任务，不要停留在新标签页或浏览器页面',
  SESSION_NOT_STABLE: 'Codex 会话正在切换，请停留在目标任务后再绑定',
  COMPOSER_NOT_FOUND: '没有找到 Codex 输入框，请先点开一个 Codex 任务',
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
  const iconPath = path.join(
    __dirname,
    'icon',
    process.platform === 'darwin' ? 'Template.png' : 'icon.ico'
  );
  if (fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      if (process.platform === 'darwin') image.setTemplateImage(true);
      return image;
    }
  }
  return createTrayIconFallback();
}

function requestMacAccessibilityPermission(prompt = true) {
  if (process.platform !== 'darwin') return true;
  const trusted = systemPreferences.isTrustedAccessibilityClient(prompt);
  if (tray) {
    setTrayStatus(trusted
      ? 'macOS 辅助功能权限正常'
      : '请在系统设置 > 隐私与安全性 > 辅助功能中启用 CodexWhip');
  }
  return trusted;
}

async function openMacAccessibilitySettings() {
  if (process.platform !== 'darwin') return;
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
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

function getWhipSendScheduler() {
  if (whipSendScheduler) return whipSendScheduler;
  whipSendScheduler = new WhipSendScheduler({
    cooldownMs: SEND_COOLDOWN_MS,
    run: performWhipSend,
    onQueued: result => {
      setTrayStatus(result.coalesced
        ? '已有一鞭排队，重复点击已合并'
        : '已记下一鞭，上一句完成后自动发送');
    },
    onQueuedError: error => {
      console.warn('codexwhip: queued send failed:', error?.message || error);
      setTrayStatus('排队发送失败：桌面自动化异常');
    },
  });
  return whipSendScheduler;
}

function isOverlayVisible() {
  return isOverlayUsable() && overlay.isVisible();
}

function selectedStyleLabel() {
  if (selectedWhipStyle === RANDOM_STYLE_ID) return '随机轮换';
  return WHIP_STYLES[selectedWhipStyle]?.label || WHIP_STYLES[DEFAULT_STYLE_ID].label;
}

function whipStyleMenuItems() {
  return [
    ...getStyleCatalog().map(style => ({
      label: style.label,
      type: 'radio',
      checked: selectedWhipStyle === style.id,
      click: () => selectWhipStyle(style.id),
    })),
    { type: 'separator' },
    {
      label: '随机轮换',
      type: 'radio',
      checked: selectedWhipStyle === RANDOM_STYLE_ID,
      click: () => selectWhipStyle(RANDOM_STYLE_ID),
    },
  ];
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
      {
        label: `鞭子款式：${selectedStyleLabel()}`,
        submenu: whipStyleMenuItems(),
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
      ...(process.platform === 'darwin' ? [
        { type: 'separator' },
        { label: '检查 macOS 辅助功能权限', click: () => requestMacAccessibilityPermission(true) },
        { label: '打开 macOS 辅助功能设置', click: openMacAccessibilitySettings },
      ] : []),
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
  if (isOverlayUsable() && overlayReady) {
    overlay.webContents.send('overlay-status', {
      status: trayStatus,
      bound: Boolean(boundSession),
      taskTitle: boundSession?.taskTitle || '',
    });
  }
}

function stylePayload({ respawn = false } = {}) {
  return {
    styleId: activeWhipStyle,
    style: WHIP_STYLES[activeWhipStyle],
    selectedStyleId: selectedWhipStyle,
    styleCatalog: getStyleCatalog().map(style => ({ id: style.id, label: style.label })),
    respawn,
  };
}

function selectWhipStyle(styleId) {
  selectedWhipStyle = styleId;
  activeWhipStyle = resolveWhipStyle(selectedWhipStyle);
  const saved = saveSettings(settingsFilePath, { whipStyle: selectedWhipStyle });
  // Keep the renderer's selected style in sync even while the overlay is
  // temporarily hidden (for example after a send or when the tray menu is
  // used before summoning the whip).  The next summon also sends a spawn
  // event, but updating the loaded page here prevents a stale first style
  // label/physics state from surviving into that summon.
  if (isOverlayUsable() && overlayReady) {
    overlay.webContents.send('refresh-whip', stylePayload({ respawn: true }));
  }
  setTrayStatus(saved.ok
    ? `已切换：${WHIP_STYLES[activeWhipStyle].label}`
    : `款式已切换，但保存失败：${WHIP_STYLES[activeWhipStyle].label}`);
  return {
    ok: saved.ok,
    styleId: activeWhipStyle,
    selectedStyleId: selectedWhipStyle,
    label: WHIP_STYLES[activeWhipStyle].label,
    code: saved.ok ? 'STYLE_CHANGED' : 'STYLE_CHANGED_NOT_SAVED',
  };
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
    const message = `绑定失败：${statusForResult(result)}`;
    setTrayStatus(message);
    return { ok: false, code: result.code || 'BINDING_FAILED', message };
  }
  if (!result.taskTitle || !result.taskRuntimeId) {
    const message = '绑定失败：无法识别当前 Codex 任务';
    setTrayStatus(message);
    return { ok: false, code: 'TASK_ID_NOT_FOUND', message };
  }

  boundSession = sessionFromProbe(result);
  const saved = saveBinding(bindingFilePath, result.taskTitle);
  const message = saved.ok
    ? `已绑定：${result.taskTitle}`
    : `已绑定，但保存失败：${result.taskTitle}`;
  setTrayStatus(message);
  return {
    ok: saved.ok,
    code: saved.ok ? 'SESSION_BOUND' : 'SESSION_BOUND_NOT_SAVED',
    taskTitle: result.taskTitle,
    message,
  };
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
    const message = '请先绑定 Codex 任务';
    setTrayStatus(message);
    return { ok: false, code: 'TARGET_SESSION_REQUIRED', message };
  }

  const result = await probeCodexDesktop({
    preferredHwnd: boundSession.hwnd,
    targetTaskTitle: boundSession.taskTitle,
    targetTaskRuntimeId: boundSession.taskRuntimeId,
  });
  if (!result.ok) {
    const message = `连接失败：${statusForResult(result)}`;
    setTrayStatus(message);
    return { ok: false, code: result.code || 'CONNECTION_FAILED', message };
  }

  boundSession.hwnd = result.hwnd;
  boundSession.processId = result.processId;
  const message = result.hasDraft ? '连接正常，但目标任务有草稿' : '连接正常，可以连续抽打';
  setTrayStatus(message);
  return {
    ok: true,
    code: result.hasDraft ? 'CONNECTION_READY_WITH_DRAFT' : 'CONNECTION_READY',
    hasDraft: Boolean(result.hasDraft),
    message,
  };
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
  // The full-screen whip otherwise covers the editor and intercepts clicks,
  // making a successful open look like a no-op.
  const wasVisible = isOverlayVisible();
  if (wasVisible) hideOverlay();
  let error;
  try {
    if (process.platform === 'darwin') {
      error = await new Promise(resolve => {
        execFile('/usr/bin/open', ['-a', 'TextEdit', phraseFilePath], cause => {
          resolve(cause?.message || '');
        });
      });
    } else {
      error = await shell.openPath(phraseFilePath);
    }
  } catch (cause) {
    error = cause?.message || String(cause);
  }
  if (error && wasVisible) revealOverlay();
  const message = error ? `打开词库失败：${error}` : '已打开中文催促词库';
  setTrayStatus(message);
  return {
    ok: !error,
    code: error ? 'PHRASE_LIBRARY_OPEN_FAILED' : 'PHRASE_LIBRARY_OPENED',
    path: phraseFilePath,
    message,
  };
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
    // A focusable window is required for macOS to place a transparent window
    // on the active Space reliably when the app is a background tray app.
    focusable: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // A screen-saver level window is visually present but is omitted by some
  // macOS display capture paths, which makes the whip look like it failed to
  // summon during recording.  Floating keeps it above Codex while remaining
  // part of the normal desktop composition.
  overlay.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  overlayReady = false;
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    overlay.webContents.send('overlay-status', {
      status: trayStatus,
      bound: Boolean(boundSession),
      taskTitle: boundSession?.taskTitle || '',
    });
    if (spawnQueued && isOverlayVisible()) {
      spawnQueued = false;
      overlay.webContents.send('spawn-whip', stylePayload());
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

  activeWhipStyle = resolveWhipStyle(selectedWhipStyle);
  overlay.show();
  if (typeof overlay.moveTop === 'function') overlay.moveTop();
  registerEscapeShortcut();
  if (overlayReady) {
    overlay.webContents.send('spawn-whip', stylePayload());
  } else {
    spawnQueued = true;
  }
  refreshTrayMenu();
}

async function lowerOverlayForDesktopSend() {
  if (!isOverlayVisible()) return;
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(false);
  // Hiding the transparent full-screen window removes it from the hit-test
  // stack entirely. This is more reliable than lowering z-order while a
  // native accessibility click is trying to focus Codex's composer.
  overlay.hide();
  overlayHiddenForDesktopSend = true;
  // Give macOS enough time to hand frontmost focus back to Codex before the
  // accessibility helper raises the bound window and focuses its composer.
  await new Promise(resolve => setTimeout(resolve, 180));
}

function restoreOverlayAfterDesktopSend() {
  if (!isOverlayUsable()) return;
  const restoreVisibility = overlayHiddenForDesktopSend;
  overlayHiddenForDesktopSend = false;
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setIgnoreMouseEvents(false);
  if (restoreVisibility) {
    if (typeof overlay.showInactive === 'function') overlay.showInactive();
    else overlay.show();
    if (typeof overlay.moveTop === 'function') overlay.moveTop();
  }
  if (overlay.isVisible()) {
    setTimeout(() => {
      if (isOverlayVisible() && overlayReady) {
        overlay.webContents.send('refresh-whip', stylePayload());
      }
    }, 80);
  }
}

async function performWhipSend() {
  try {
    if (!boundSession) {
      await restoreSavedSession();
    }
    if (!boundSession) {
      setTrayStatus('请先绑定 Codex 任务');
      return { status: 'unbound', code: 'TARGET_SESSION_REQUIRED' };
    }

    const phrase = phraseLibrary?.choose() || DEFAULT_PHRASES[0];
    setTrayStatus(`正在发送到「${shorten(boundSession.taskTitle, 20)}」：${phrase}`);
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
    setTrayStatus(getWhipSendScheduler().hasPending
      ? `已发送，下一鞭排队中：${result.phrase}`
      : `已发送：${result.phrase}`);
    return responseForResult(result);
  } catch (error) {
    console.warn('codexwhip: desktop send failed:', error?.message || error);
    setTrayStatus('发送失败：桌面自动化异常');
    return { status: 'failed', code: 'DESKTOP_AUTOMATION_FAILED' };
  }
}

ipcMain.handle('whip-crack', () => getWhipSendScheduler().request());
ipcMain.handle('select-whip-style', (_event, styleId) => selectWhipStyle(styleId));
ipcMain.handle('bind-current-session', () => bindCurrentSession());
ipcMain.handle('test-codex-connection', () => testCodexConnection());
ipcMain.handle('open-phrase-library', () => openPhraseLibrary());

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
    if (!['win32', 'darwin'].includes(process.platform)) {
      console.warn('codexwhip: CodexWhip Desktop supports Windows and macOS only.');
      app.quit();
      return;
    }

    if (process.platform === 'win32') app.setAppUserModelId('com.weiling.codexwhip');
    if (process.platform === 'darwin') app.dock?.hide();
    const steerModeResult = ensureCodexSteerMode();
    steerModeReady = steerModeResult.ok;
    const storageDir = path.join(app.getPath('appData'), 'codexwhip');
    phraseFilePath = path.join(storageDir, 'phrases.json');
    bindingFilePath = path.join(storageDir, 'binding.json');
    settingsFilePath = path.join(storageDir, 'settings.json');
    const settingsResult = loadSettings(settingsFilePath);
    selectedWhipStyle = settingsResult.settings.whipStyle;
    activeWhipStyle = resolveWhipStyle(selectedWhipStyle);
    const phraseResult = initializePhraseLibrary();

    tray = new Tray(getTrayIcon());
    refreshTrayMenu();
    tray.on('click', toggleOverlay);

    const accessibilityReady = requestMacAccessibilityPermission(true);
    await restoreSavedSession();
    if (!accessibilityReady) {
      setTrayStatus('请先授予 macOS 辅助功能权限，再绑定 Codex 任务');
    }
    if (!steerModeResult.ok) {
      setTrayStatus(`直接发送未启用：${statusForResult(steerModeResult)}`);
    }
    if (!phraseResult.ok) {
      setTrayStatus(`词库无效，继续使用默认中文词库：${phraseResult.message}`);
    }
    if (!settingsResult.ok) {
      setTrayStatus('款式设置无效，已恢复黑红长皮鞭');
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
  whipSendScheduler?.dispose();
  phraseLibrary?.close();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', event => event.preventDefault());
