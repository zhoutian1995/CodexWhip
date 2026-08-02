const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.invoke('whip-crack'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', (_event, payload) => fn(payload)),
  onRefreshWhip: (fn) => ipcRenderer.on('refresh-whip', (_event, payload) => fn(payload)),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
});
