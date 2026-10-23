const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('nebula', {
  status: () => ipcRenderer.invoke('engine:status'),
  open: () => ipcRenderer.invoke('document:open'),
  save: (payload, saveAs) => ipcRenderer.invoke('document:save', payload, saveAs),
  setDirty: dirty => ipcRenderer.send('document:dirty', dirty),
  onMenu: callback => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
})
