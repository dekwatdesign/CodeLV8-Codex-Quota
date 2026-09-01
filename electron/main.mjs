import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "./quota-client.mjs";
import { readSettings, writeSettings } from "./state.mjs";
import { createUpdateManager } from "./updater.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_SIZE = Object.freeze({ width: 456, compactHeight: 240, expandedHeight: 360 });
const isDemo = process.argv.includes("--demo") || process.env.CODEX_QUOTA_DEMO === "1";
const hasSingleInstance = app.requestSingleInstanceLock();

if (!hasSingleInstance) {
  app.quit();
} else {
  let overlayWindow;
  let tray;
  let settingsFile;
  let settings;
  let client;
  let updateManager;
  let isQuitting = false;
  let positionSaveTimer;
  let dragActive = false;

  function emitSettings() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("overlay:settings", settings);
  }

  function emitUpdateState() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("update:state", updateManager?.getState());
  }

  function boundsFor(expanded, preferredPosition) {
    const x = Number(preferredPosition?.x);
    const y = Number(preferredPosition?.y);
    const hasPreferredPosition = Number.isFinite(x) && Number.isFinite(y);
    const display = hasPreferredPosition
      ? screen.getDisplayNearestPoint({ x, y }) || screen.getPrimaryDisplay()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(WINDOW_SIZE.width, Math.max(320, area.width - 32));
    const height = Math.min(expanded ? WINDOW_SIZE.expandedHeight : WINDOW_SIZE.compactHeight, Math.max(88, area.height - 32));
    return {
      x: hasPreferredPosition
        ? Math.round(Math.max(area.x - width + 80, Math.min(area.x + area.width - 80, x)))
        : Math.round(area.x + (area.width - width) / 2),
      y: hasPreferredPosition
        ? Math.round(Math.max(area.y, Math.min(area.y + area.height - 40, y)))
        : Math.round(area.y + 18),
      width,
      height,
    };
  }

  function resizeOverlay() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [x, y] = overlayWindow.getPosition();
    overlayWindow.setBounds(boundsFor(settings.expanded, { x, y }));
  }

  function saveOverlayPosition() {
    if (!overlayWindow || overlayWindow.isDestroyed() || !settingsFile) return;
    const [x, y] = overlayWindow.getPosition();
    if (settings.position?.x === x && settings.position?.y === y) return;
    settings = writeSettings(settingsFile, { ...settings, position: { x, y } });
  }

  function schedulePositionSave() {
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => {
      positionSaveTimer = undefined;
      saveOverlayPosition();
    }, 150);
  }

  function startOverlayDrag() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    dragActive = true;
  }

  function moveOverlayBy(deltaX, deltaY) {
    if (!overlayWindow || overlayWindow.isDestroyed() || !dragActive) return;
    const x = Number(deltaX);
    const y = Number(deltaY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const [windowX, windowY] = overlayWindow.getPosition();
    const nextBounds = boundsFor(settings.expanded, {
      x: windowX + x,
      y: windowY + y,
    });
    overlayWindow.setPosition(nextBounds.x, nextBounds.y);
  }

  function endOverlayDrag() {
    dragActive = false;
  }

  function applyStartWithWindows(enabled) {
    if (process.platform !== "win32") return true;
    try {
      const options = {
        openAtLogin: enabled === true,
        path: process.execPath,
      };
      if (!app.isPackaged) options.args = [app.getAppPath()];
      app.setLoginItemSettings(options);
      return true;
    } catch (error) {
      console.error("Unable to update Windows startup setting", error);
      return false;
    }
  }

  function showWindow() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    resizeOverlay();
    overlayWindow.showInactive();
    overlayWindow.setAlwaysOnTop(true, "floating");
  }

  function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: "Show Codex Quota",
        enabled: !overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible(),
        click: () => setOverlayEnabled(true),
      },
      {
        label: "Hide overlay",
        enabled: Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
        click: () => setOverlayEnabled(false),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]));
  }

  function setOverlayEnabled(enabled) {
    settings = writeSettings(settingsFile, { ...settings, enabled: enabled === true });
    if (settings.enabled) showWindow();
    else if (overlayWindow && !overlayWindow.isDestroyed()) {
      endOverlayDrag();
      overlayWindow.hide();
    }
    emitSettings();
    updateTrayMenu();
    return settings;
  }

  function toggleOverlay() {
    const visible = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
    setOverlayEnabled(!visible);
  }

  function createTray() {
    const iconPath = path.join(__dirname, "..", "assets", "codex-quota.png");
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error(`Unable to load tray icon: ${iconPath}`);
      return;
    }
    tray = new Tray(process.platform === "win32" ? icon.resize({ width: 16, height: 16 }) : icon);
    tray.setToolTip("Codex Quota");
    tray.on("click", () => toggleOverlay());
    tray.on("double-click", () => setOverlayEnabled(true));
    updateTrayMenu();
  }

  function registerIpc() {
    ipcMain.handle("overlay:get-settings", () => settings);
    ipcMain.handle("overlay:show", () => setOverlayEnabled(true));
    ipcMain.handle("overlay:hide", () => setOverlayEnabled(false));
    ipcMain.handle("overlay:set-enabled", (_event, enabled) => setOverlayEnabled(enabled));
    ipcMain.handle("overlay:drag-start", (event) => {
      if (overlayWindow && event.sender === overlayWindow.webContents) startOverlayDrag();
    });
    ipcMain.handle("overlay:drag-move", (event, deltaX, deltaY) => {
      if (overlayWindow && event.sender === overlayWindow.webContents) moveOverlayBy(deltaX, deltaY);
    });
    ipcMain.handle("overlay:drag-end", (event) => {
      if (overlayWindow && event.sender === overlayWindow.webContents) endOverlayDrag();
    });
    ipcMain.handle("overlay:set-expanded", (_event, expanded) => {
      settings = writeSettings(settingsFile, { ...settings, expanded: expanded === true });
      resizeOverlay();
      emitSettings();
      return settings;
    });
    ipcMain.handle("overlay:set-start-with-windows", (_event, enabled) => {
      const next = enabled === true;
      if (!applyStartWithWindows(next)) {
        throw new Error("Unable to update Windows startup setting");
      }
      settings = writeSettings(settingsFile, { ...settings, startWithWindows: next });
      emitSettings();
      return settings;
    });
    ipcMain.handle("update:get-state", () => updateManager?.getState());
    ipcMain.handle("update:check", () => updateManager?.check({ manual: true }));
    ipcMain.handle("update:install", () => updateManager?.install());
    ipcMain.handle("quota:get-health", () => client.getHealth());
    ipcMain.handle("quota:get-account-usage", () => client.getAccountUsage());
    ipcMain.handle("quota:get-provider-usage", () => client.getProviderUsage());
  }

  async function createWindow() {
    settingsFile = path.join(app.getPath("userData"), "state.json");
    settings = readSettings(settingsFile);
    applyStartWithWindows(settings.startWithWindows);
    updateManager = createUpdateManager({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      enabled: !isDemo,
      onStateChange: emitUpdateState,
    });
    client = new QuotaClient({ demo: isDemo });
    client.start();
    registerIpc();
    createTray();
    overlayWindow = new BrowserWindow({
      ...boundsFor(settings.expanded, settings.position),
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    overlayWindow.setAlwaysOnTop(true, "floating");
    overlayWindow.on("move", schedulePositionSave);
    overlayWindow.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      setOverlayEnabled(false);
    });
    overlayWindow.on("closed", () => {
      if (positionSaveTimer) clearTimeout(positionSaveTimer);
      positionSaveTimer = undefined;
      endOverlayDrag();
      overlayWindow = undefined;
      updateTrayMenu();
    });
    overlayWindow.webContents.on("did-finish-load", () => {
      if (settings.enabled) showWindow();
      updateTrayMenu();
    });
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) await overlayWindow.loadURL(devUrl);
    else await overlayWindow.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));
    updateManager.start();
    emitUpdateState();
  }

  app.on("second-instance", () => {
    if (settings) setOverlayEnabled(true);
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("io.codelv8.codexquota");
    await createWindow();
  }).catch((error) => {
    console.error(error);
    isQuitting = true;
    app.quit();
  });
  app.on("before-quit", () => {
    isQuitting = true;
    endOverlayDrag();
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = undefined;
    saveOverlayPosition();
    tray?.destroy();
    tray = undefined;
    updateManager?.stop();
    client?.stop();
  });
  app.on("window-all-closed", (event) => {
    if (!isQuitting) event.preventDefault();
  });
  app.on("activate", () => {
    if (settings) setOverlayEnabled(true);
  });
}
