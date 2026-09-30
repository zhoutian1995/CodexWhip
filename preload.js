const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.invoke('whip-crack'),
  selectWhipStyle: (styleId) => ipcRenderer.invoke('select-whip-style', styleId),
  bindCurrentSession: () => ipcRenderer.invoke('bind-current-session'),
  testCodexConnection: () => ipcRenderer.invoke('test-codex-connection'),
  openPhraseLibrary: () => ipcRenderer.invoke('open-phrase-library'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', (_event, payload) => fn(payload)),
  onRefreshWhip: (fn) => ipcRenderer.on('refresh-whip', (_event, payload) => fn(payload)),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
  onOverlayStatus: (fn) => ipcRenderer.on('overlay-status', (_event, payload) => fn(payload)),
});
