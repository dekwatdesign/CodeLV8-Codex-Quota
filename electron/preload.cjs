const { contextBridge, ipcRenderer } = require("electron");

const api = {
  platform: process.platform,
  getOverlaySettings: () => ipcRenderer.invoke("overlay:get-settings"),
  showOverlay: () => ipcRenderer.invoke("overlay:show"),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  setOverlayEnabled: (enabled) => ipcRenderer.invoke("overlay:set-enabled", enabled),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("overlay:set-expanded", expanded),
  setStartWithWindows: (enabled) => ipcRenderer.invoke("overlay:set-start-with-windows", enabled),
  startOverlayDrag: () => ipcRenderer.invoke("overlay:drag-start"),
  moveOverlayBy: (deltaX, deltaY) => ipcRenderer.invoke("overlay:drag-move", deltaX, deltaY),
  endOverlayDrag: () => ipcRenderer.invoke("overlay:drag-end"),
  getHealth: () => ipcRenderer.invoke("quota:get-health"),
  getAccountUsage: () => ipcRenderer.invoke("quota:get-account-usage"),
  getProviderUsage: () => ipcRenderer.invoke("quota:get-provider-usage"),
  onOverlaySettings: (listener) => {
    const handler = (_event, settings) => listener(settings);
    ipcRenderer.on("overlay:settings", handler);
    return () => ipcRenderer.removeListener("overlay:settings", handler);
  },
};

contextBridge.exposeInMainWorld("routerControl", api);
