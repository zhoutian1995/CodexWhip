const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getStyleCatalog } = require('../lib/whip-styles');

const ROOT = path.join(__dirname, '..');
const STYLE_IDS = ['leather', 'crop', 'flogger', 'chain', 'cyber'];
const STYLE_BY_ID = new Map(getStyleCatalog().map(style => [style.id, style]));

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function delay(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
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
  const screenshotPath = path.join(os.tmpdir(), `codexwhip-1.4.0-${styleId}.png`);
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
    `codexwhip-1.4.0-${width}x${height}-${scaleLabel}.png`
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

async function main() {
  ipcMain.handle('whip-crack', async () => ({ status: 'sent', code: 'SMOKE_TEST' }));
  ipcMain.on('hide-overlay', () => {});
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
  await window.loadFile(path.join(ROOT, 'overlay.html'));
  const readyState = await window.webContents.executeJavaScript(`({
    bridge: typeof window.bridge,
    metrics: typeof window.__codexWhipMetrics,
  })`);
  if (readyState.bridge !== 'object' || readyState.metrics !== 'object') {
    throw new Error(`overlay smoke bridge not ready: ${JSON.stringify(readyState)}`);
  }
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
  window.destroy();
  ipcMain.removeHandler('whip-crack');
  ipcMain.removeAllListeners('hide-overlay');
  process.stdout.write(`${JSON.stringify({ styles: results, viewports: viewportResults }, null, 2)}\n`);
  if (results.some(result => result.activeStyle !== result.styleId)) process.exitCode = 1;
  if (results.some(result => result.p95RenderCostMs > 33)) process.exitCode = 1;
  if (results.some(result => result.p95FrameIntervalMs > 34 || result.frames < 20)) process.exitCode = 1;
  if (viewportResults.some(result => result.highContrastSamples < 20)) process.exitCode = 1;
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
