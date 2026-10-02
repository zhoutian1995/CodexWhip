const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.invoke('whip-crack'),
  summonWhip: () => ipcRenderer.invoke('summon-whip'),
  selectWhipStyle: (styleId) => ipcRenderer.invoke('select-whip-style', styleId),
  bindCurrentSession: () => ipcRenderer.invoke('bind-current-session'),
  testCodexConnection: () => ipcRenderer.invoke('test-codex-connection'),
  openPhraseLibrary: () => ipcRenderer.invoke('open-phrase-library'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  collapseOverlayToControls: () => ipcRenderer.send('collapse-overlay-controls'),
  setControlMenusExpanded: (expanded) => ipcRenderer.send('control-menus-expanded', Boolean(expanded)),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', (_event, payload) => fn(payload)),
  onRefreshWhip: (fn) => ipcRenderer.on('refresh-whip', (_event, payload) => fn(payload)),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
  onOverlayMode: (fn) => ipcRenderer.on('overlay-mode', (_event, mode) => fn(mode)),
  onOverlayStatus: (fn) => ipcRenderer.on('overlay-status', (_event, payload) => fn(payload)),
});
