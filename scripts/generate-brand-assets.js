const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'icon');
const ASSET_DIR = path.join(ROOT, 'assets');

function htmlFor(mode, width, height) {
  const source = String.raw`
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    function leatherTexture(cx, cy, radius, count) {
      let seed = 1407;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1.5;
      for (let index = 0; index < count; index++) {
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * radius;
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        const length = 5 + random() * 18;
        ctx.beginPath();
        ctx.moveTo(x - length / 2, y);
        ctx.quadraticCurveTo(x, y + (random() - 0.5) * 7, x + length / 2, y + (random() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawRing(cx, cy, radius, width) {
      ctx.save();
      ctx.lineWidth = width + 8;
      ctx.strokeStyle = '#191c21';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = width;
      ctx.strokeStyle = '#aeb4bc';
      ctx.stroke();
      ctx.lineWidth = Math.max(2, width * 0.15);
      ctx.strokeStyle = '#f5f6f7';
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 3, radius, Math.PI * 1.08, Math.PI * 1.82);
      ctx.stroke();
      ctx.strokeStyle = '#555d67';
      ctx.beginPath();
      ctx.arc(cx + 2, cy + 4, radius, Math.PI * 0.08, Math.PI * 0.82);
      ctx.stroke();
      ctx.restore();
    }

    function strokePath(path, edgeWidth, coreWidth, highlightWidth) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#460914';
      ctx.lineWidth = edgeWidth;
      ctx.stroke(path);
      ctx.strokeStyle = '#07080a';
      ctx.lineWidth = coreWidth;
      ctx.stroke(path);
      ctx.strokeStyle = '#b51c31';
      ctx.lineWidth = highlightWidth;
      ctx.stroke(path);
      ctx.restore();
    }

    function drawEmblem(cx, cy, scale) {
      const radius = 410 * scale;
      ctx.save();
      ctx.fillStyle = '#050608';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 30 * scale;
      ctx.strokeStyle = '#23060b';
      ctx.stroke();
      ctx.setLineDash([9 * scale, 11 * scale]);
      ctx.lineWidth = 5 * scale;
      ctx.strokeStyle = '#8c1a28';
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 31 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      leatherTexture(cx, cy, radius - 45 * scale, Math.round(250 * scale));
      drawRing(cx + 18 * scale, cy - 8 * scale, 108 * scale, 30 * scale);

      const whip = new Path2D();
      whip.moveTo(cx + 247 * scale, cy - 205 * scale);
      whip.bezierCurveTo(
        cx + 105 * scale, cy - 330 * scale,
        cx - 235 * scale, cy - 264 * scale,
        cx - 245 * scale, cy - 18 * scale
      );
      whip.bezierCurveTo(
        cx - 255 * scale, cy + 187 * scale,
        cx - 28 * scale, cy + 225 * scale,
        cx + 65 * scale, cy + 79 * scale
      );
      whip.bezierCurveTo(
        cx + 122 * scale, cy - 10 * scale,
        cx + 130 * scale, cy + 250 * scale,
        cx + 260 * scale, cy + 118 * scale
      );
      strokePath(whip, 64 * scale, 47 * scale, 7 * scale);

      ctx.save();
      ctx.translate(cx + 258 * scale, cy - 204 * scale);
      ctx.rotate(-0.55);
      ctx.fillStyle = '#08090b';
      ctx.strokeStyle = '#7b1321';
      ctx.lineWidth = 8 * scale;
      ctx.beginPath();
      ctx.roundRect(-36 * scale, -72 * scale, 72 * scale, 144 * scale, 28 * scale);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#f02a43';
      ctx.lineWidth = 13 * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + 256 * scale, cy + 119 * scale);
      ctx.lineTo(cx + 330 * scale, cy + 185 * scale);
      ctx.stroke();
      ctx.lineWidth = 4 * scale;
      ctx.strokeStyle = '#ff7888';
      ctx.beginPath();
      ctx.moveTo(cx + 278 * scale, cy + 139 * scale);
      ctx.lineTo(cx + 329 * scale, cy + 184 * scale);
      ctx.stroke();
      ctx.restore();
    }

    function drawLeatherWhip(x, y, scale) {
      const path = new Path2D();
      path.moveTo(x, y);
      path.bezierCurveTo(x + 65 * scale, y - 115 * scale, x + 210 * scale, y - 105 * scale, x + 275 * scale, y - 14 * scale);
      path.bezierCurveTo(x + 340 * scale, y + 76 * scale, x + 420 * scale, y + 35 * scale, x + 462 * scale, y - 25 * scale);
      strokePath(path, 18 * scale, 12 * scale, 2 * scale);
    }

    function drawFlogger(x, y, scale) {
      for (let index = 0; index < 7; index++) {
        const offset = (index - 3) * 17 * scale;
        const path = new Path2D();
        path.moveTo(x, y);
        path.bezierCurveTo(x + 105 * scale, y - 95 * scale + offset, x + 275 * scale, y - 25 * scale + offset, x + 395 * scale, y + offset * 0.7);
        strokePath(path, 9 * scale, 5 * scale, 1 * scale);
      }
    }

    function drawChain(x, y, scale) {
      ctx.save();
      for (let index = 0; index < 14; index++) {
        const t = index / 13;
        const px = x + t * 430 * scale;
        const py = y - Math.sin(t * Math.PI) * 92 * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(t * 1.2 + (index % 2 ? Math.PI / 2 : 0));
        ctx.strokeStyle = '#11141a';
        ctx.lineWidth = 9 * scale;
        ctx.beginPath();
        ctx.ellipse(0, 0, 22 * scale, 11 * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#bbc1c9';
        ctx.lineWidth = 4 * scale;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    function drawCyber(x, y, scale) {
      drawLeatherWhip(x, y, scale);
      ctx.save();
      ctx.strokeStyle = '#ff304b';
      ctx.lineWidth = 3 * scale;
      for (let index = 0; index < 4; index++) {
        const sx = x + (110 + index * 75) * scale;
        const sy = y - (70 - index * 15) * scale;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 20 * scale, sy - 24 * scale);
        ctx.lineTo(sx + 42 * scale, sy + 10 * scale);
        ctx.stroke();
      }
      ctx.restore();
    }

    function background() {
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#16040a';
      ctx.beginPath();
      ctx.moveTo(W * 0.68, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, H);
      ctx.lineTo(W * 0.88, H);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(177,28,48,0.32)';
      ctx.lineWidth = 2;
      for (let y = 22; y < H; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y - 15);
        ctx.stroke();
      }
    }

    function drawCover() {
      background();
      drawEmblem(285, H / 2, 0.48);
      ctx.fillStyle = '#f5f5f4';
      ctx.font = '900 112px Segoe UI, Microsoft YaHei, sans-serif';
      ctx.fillText('CODEXWHIP', 560, 220);
      ctx.fillStyle = '#d7243d';
      ctx.fillRect(566, 256, 118, 8);
      ctx.fillStyle = '#c7c9cc';
      ctx.font = '600 38px Microsoft YaHei, Segoe UI, sans-serif';
      ctx.fillText('四种鞭子，一次绑定，连续抽打', 560, 333);
      ctx.fillStyle = '#777d85';
      ctx.font = '500 25px Microsoft YaHei, Segoe UI, sans-serif';
      ctx.fillText('公开暗黑器具美学 · 无露骨内容 · Windows Codex Desktop', 562, 389);
    }

    function drawStyles() {
      background();
      ctx.fillStyle = '#f5f5f4';
      ctx.font = '800 52px Microsoft YaHei, Segoe UI, sans-serif';
      ctx.fillText('四种鞭子，四种催活手感', 64, 78);
      ctx.fillStyle = '#d7243d';
      ctx.fillRect(65, 102, 120, 6);
      const labels = ['黑红长皮鞭', '七尾多尾鞭', '银黑锁链鞭', '赛博高压电缆鞭'];
      const drawers = [drawLeatherWhip, drawFlogger, drawChain, drawCyber];
      const column = W / 4;
      for (let index = 0; index < 4; index++) {
        const left = index * column;
        if (index > 0) {
          ctx.strokeStyle = '#351018';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(left, 132);
          ctx.lineTo(left, H - 38);
          ctx.stroke();
        }
        ctx.fillStyle = '#aeb2b7';
        ctx.font = '700 28px Microsoft YaHei, Segoe UI, sans-serif';
        ctx.fillText(labels[index], left + 34, 172);
        ctx.fillStyle = '#7f1320';
        ctx.font = '900 88px Segoe UI, sans-serif';
        ctx.globalAlpha = 0.22;
        ctx.fillText(String(index + 1).padStart(2, '0'), left + 205, 240);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(left + 35, 365);
        ctx.rotate(-0.08);
        drawers[index](0, 0, 0.54);
        ctx.restore();
      }
    }

    if (${JSON.stringify(mode)} === 'icon') drawEmblem(W / 2, H / 2, 1);
    if (${JSON.stringify(mode)} === 'cover') drawCover();
    if (${JSON.stringify(mode)} === 'styles') drawStyles();
  `;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0}html,body{width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block}</style></head><body><canvas id="canvas" width="${width}" height="${height}"></canvas><script>${source}<\/script></body></html>`;
}

async function render(mode, width, height) {
  const temporaryHtml = path.join(
    app.getPath('temp'),
    `codexwhip-brand-${mode}-${process.pid}.html`
  );
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    transparent: mode === 'icon',
    backgroundColor: mode === 'icon' ? '#00000000' : '#050608',
    webPreferences: {
      backgroundThrottling: false,
    },
  });
  const html = htmlFor(mode, width, height);
  fs.writeFileSync(temporaryHtml, html, 'utf8');
  try {
    await window.loadURL(pathToFileURL(temporaryHtml).href);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return await window.webContents.capturePage({ x: 0, y: 0, width, height });
  } finally {
    window.destroy();
    fs.rmSync(temporaryHtml, { force: true });
  }
}

function writeIco(filePath, images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;

  images.forEach((item, index) => {
    const entryOffset = index * 16;
    entries.writeUInt8(item.size >= 256 ? 0 : item.size, entryOffset);
    entries.writeUInt8(item.size >= 256 ? 0 : item.size, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);
    entries.writeUInt8(0, entryOffset + 3);
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(item.buffer.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += item.buffer.length;
  });

  fs.writeFileSync(filePath, Buffer.concat([header, entries, ...images.map(item => item.buffer)]));
}

async function main() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  fs.mkdirSync(ASSET_DIR, { recursive: true });

  const icon = await render('icon', 1024, 1024);
  fs.writeFileSync(path.join(ICON_DIR, 'CodexWhip-1024.png'), icon.toPNG());
  fs.writeFileSync(path.join(ICON_DIR, 'Template.png'), icon.resize({ width: 512, height: 512, quality: 'best' }).toPNG());

  const sizes = [16, 24, 32, 48, 256];
  const icoImages = sizes.map(size => ({
    size,
    buffer: icon.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  for (const item of icoImages) {
    fs.writeFileSync(path.join(ICON_DIR, `icon-${item.size}.png`), item.buffer);
  }
  writeIco(path.join(ICON_DIR, 'icon.ico'), icoImages);

  const cover = await render('cover', 1536, 512);
  fs.writeFileSync(path.join(ASSET_DIR, 'codexwhip-cover.png'), cover.toPNG());
  const styles = await render('styles', 1536, 600);
  fs.writeFileSync(path.join(ASSET_DIR, 'whip-styles.png'), styles.toPNG());
}

app.on('window-all-closed', () => {});

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
