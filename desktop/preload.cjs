const { contextBridge, ipcRenderer } = require('electron');

// Expose only the desktop actions used by the game.
contextBridge.exposeInMainWorld('jugreDesktop', Object.freeze({
  exit: () => ipcRenderer.send('jugre:exit'),
  si: Object.freeze({
    propose: prompt => ipcRenderer.invoke('jugre:si:propose', prompt),
  }),
}));
