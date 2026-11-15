const { contextBridge, ipcRenderer } = require('electron');

// The renderer receives only the one desktop action it needs.
contextBridge.exposeInMainWorld('jugreDesktop', Object.freeze({
  exit: () => ipcRenderer.send('jugre:exit'),
}));
