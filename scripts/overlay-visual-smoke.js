const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { version: PACKAGE_VERSION } = require('../package.json');
const { getStyleCatalog } = require('../lib/whip-styles');

const ROOT = path.join(__dirname, '..');
const STYLE_IDS = ['leather', 'flogger', 'chain', 'cyber'];
const STYLE_BY_ID = new Map(getStyleCatalog().map(style => [style.id, style]));
let crackRequestCount = 0;
let hideRequestCount = 0;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function delay(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function dispatchMouseDown(window, { button, x, y }) {
  await window.webContents.executeJavaScript(`
    document.dispatchEvent(new MouseEvent('mousedown', {
      button: ${button},
      clientX: ${x},
      clientY: ${y}
    }));
    true;
  `);
}

async function exerciseInteractions(window) {
  window.webContents.send('spawn-whip', {
    styleId: 'leather',
    style: STYLE_BY_ID.get('leather'),
  });
  await delay(30);

  const beforeSingle = crackRequestCount;
  await dispatchMouseDown(window, { button: 0, x: 620, y: 360 });
  await delay(280);
  const singleRequestCount = crackRequestCount - beforeSingle;

  const beforeRapid = crackRequestCount;
  for (let index = 0; index < 3; index++) {
    await dispatchMouseDown(window, { button: 0, x: 660 + index * 12, y: 380 });
    await delay(20);
  }
  await delay(280);
  const rapidRequestCount = crackRequestCount - beforeRapid;

  window.webContents.send('spawn-whip', {
    styleId: 'leather',
    style: STYLE_BY_ID.get('leather'),
  });
  await delay(30);
  const beforeClose = crackRequestCount;
  await dispatchMouseDown(window, { button: 0, x: 700, y: 400 });
  await delay(20);
  await dispatchMouseDown(window, { button: 2, x: 720, y: 410 });
  await delay(280);
  const closePreservedRequestCount = crackRequestCount - beforeClose;
  await delay(1800);

  return {
    singleRequestCount,
    rapidRequestCount,
    closePreservedRequestCount,
    hideRequestCount,
  };
}

async function exerciseStyle(window, styleId) {
  await window.webContents.executeJavaScript(`
    window.__codexWhipMetrics.renderCosts.length = 0;
    window.__codexWhipMetrics.frameIntervals.length = 0;
    true;
  `);
  window.webContents.send('spawn-whip', {
    styleId,
    style: STYLE_BY_ID.get(styleId),
  });
  await delay(20);
  await window.webContents.executeJavaScript(`
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 430, clientY: 430 }));
    true;
  `);

  for (let index = 0; index < 24; index++) {
    const x = 430 + Math.sin(index * 0.72) * 230;
    const y = 420 + Math.cos(index * 0.55) * 150;
    await window.webContents.executeJavaScript(`
      document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: ${x.toFixed(2)},
        clientY: ${y.toFixed(2)}
      }));
      true;
    `);
    await delay(18);
  }

  await window.webContents.executeJavaScript(`
    document.dispatchEvent(new MouseEvent('mousedown', {
      button: 0,
      clientX: 620,
      clientY: 360
    }));
    true;
  `);
  await delay(420);

  const metrics = await window.webContents.executeJavaScript(`({
    renderCosts: [...window.__codexWhipMetrics.renderCosts],
    frameIntervals: [...window.__codexWhipMetrics.frameIntervals].filter(value => value < 100),
    style: document.body.dataset.whipStyle,
  })`);
  const image = await window.webContents.capturePage();
  const screenshotPath = path.join(os.tmpdir(), `codexwhip-${PACKAGE_VERSION}-${styleId}.png`);
  fs.writeFileSync(screenshotPath, image.toPNG());
  return {
    styleId,
    activeStyle: metrics.style,
    screenshotPath,
    frames: metrics.renderCosts.length,
    p95RenderCostMs: Number(percentile(metrics.renderCosts, 0.95).toFixed(3)),
    p95FrameIntervalMs: Number(percentile(metrics.frameIntervals, 0.95).toFixed(3)),
  };
}

async function exerciseViewport(window, { width, height, zoomFactor }) {
  window.setSize(width, height);
  window.webContents.setZoomFactor(zoomFactor);
  await delay(120);
  window.webContents.send('spawn-whip', {
    styleId: 'cyber',
    style: STYLE_BY_ID.get('cyber'),
  });
  await delay(20);
  await window.webContents.executeJavaScript(`
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: window.innerWidth * 0.32,
      clientY: window.innerHeight * 0.58
    }));
    true;
  `);
  await delay(260);
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const bitmap = image.toBitmap();
  let highContrastSamples = 0;
  for (let index = 0; index < bitmap.length; index += 64) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    if (red > 95 || green > 95 || blue > 95) highContrastSamples++;
  }
  const scaleLabel = String(Math.round(zoomFactor * 100));
  const screenshotPath = path.join(
    os.tmpdir(),
    `codexwhip-${PACKAGE_VERSION}-${width}x${height}-${scaleLabel}.png`
  );
  fs.writeFileSync(screenshotPath, image.toPNG());
  return {
    width,
    height,
    zoomFactor,
    capturedWidth: size.width,
    capturedHeight: size.height,
    highContrastSamples,
    screenshotPath,
  };
}

async function exerciseIdleStop(window) {
  await window.webContents.executeJavaScript(`
    window.__codexWhipMetrics.totalFrames = 0;
    true;
  `);
  window.webContents.send('spawn-whip', {
    styleId: 'leather',
    style: STYLE_BY_ID.get('leather'),
  });
  await delay(3800);
  const beforeIdleWindow = await window.webContents.executeJavaScript(
    'window.__codexWhipMetrics.totalFrames'
  );
  await delay(600);
  const afterIdleWindow = await window.webContents.executeJavaScript(
    'window.__codexWhipMetrics.totalFrames'
  );
  return {
    beforeIdleWindow,
    afterIdleWindow,
    additionalFrames: afterIdleWindow - beforeIdleWindow,
  };
}

async function main() {
  ipcMain.handle('whip-crack', async () => {
    crackRequestCount++;
    return { status: 'sent', code: 'SMOKE_TEST' };
  });
  ipcMain.on('hide-overlay', () => {
    hideRequestCount++;
  });
  const window = new BrowserWindow({
    show: true,
    x: -32000,
    y: -32000,
    width: 1280,
    height: 720,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: '#202124',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.setIgnoreMouseEvents(true);
  await window.loadFile(path.join(ROOT, 'overlay.html'));
  const readyState = await window.webContents.executeJavaScript(`({
    bridge: typeof window.bridge,
    metrics: typeof window.__codexWhipMetrics,
  })`);
  if (readyState.bridge !== 'object' || readyState.metrics !== 'object') {
    throw new Error(`overlay smoke bridge not ready: ${JSON.stringify(readyState)}`);
  }
  const interactions = await exerciseInteractions(window);
  const results = [];
  for (const styleId of STYLE_IDS) {
    results.push(await exerciseStyle(window, styleId));
  }
  const viewportResults = [];
  for (const viewport of [
    { width: 1920, height: 1080, zoomFactor: 1 },
    { width: 1920, height: 1080, zoomFactor: 1.25 },
    { width: 1920, height: 1080, zoomFactor: 1.5 },
    { width: 2560, height: 1440, zoomFactor: 2 },
  ]) {
    viewportResults.push(await exerciseViewport(window, viewport));
  }
  const idleStop = await exerciseIdleStop(window);
  window.destroy();
  ipcMain.removeHandler('whip-crack');
  ipcMain.removeAllListeners('hide-overlay');
  process.stdout.write(`${JSON.stringify({
    interactions,
    idleStop,
    styles: results,
    viewports: viewportResults,
  }, null, 2)}\n`);
  const failures = [];
  if (interactions.singleRequestCount !== 1) failures.push('single click IPC count');
  if (interactions.rapidRequestCount !== 3) failures.push('rapid click IPC count');
  if (interactions.closePreservedRequestCount !== 1) failures.push('close preserves queued click');
  if (interactions.hideRequestCount !== 0) failures.push('right click closes the whole overlay');
  if (idleStop.additionalFrames > 2) failures.push('idle frame stop');
  if (results.some(result => result.activeStyle !== result.styleId)) failures.push('style activation');
  if (results.some(result => result.p95RenderCostMs > 33)) failures.push('render cost');
  // A 30 FPS target is 33.33ms; allow one scheduler millisecond for the
  // Electron/macOS compositor while still catching real frame stalls.
  if (results.some(result => result.p95FrameIntervalMs > 35 || result.frames < 20)) {
    failures.push('frame cadence');
  }
  if (viewportResults.some(result => result.highContrastSamples < 20)) failures.push('viewport rendering');
  if (failures.length) throw new Error(`overlay visual smoke failed: ${failures.join(', ')}`);
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
