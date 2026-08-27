import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "./quota-client.mjs";
import { readSettings, writeSettings } from "./state.mjs";

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
  let isQuitting = false;

  function emitSettings() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("overlay:settings", settings);
  }

  function boundsFor(expanded) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(WINDOW_SIZE.width, Math.max(320, area.width - 32));
    const height = Math.min(expanded ? WINDOW_SIZE.expandedHeight : WINDOW_SIZE.compactHeight, Math.max(88, area.height - 32));
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + 18),
      width,
      height,
    };
  }

  function resizeOverlay() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setBounds(boundsFor(settings.expanded));
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
    else if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
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
    ipcMain.handle("overlay:set-expanded", (_event, expanded) => {
      settings = writeSettings(settingsFile, { ...settings, expanded: expanded === true });
      resizeOverlay();
      emitSettings();
      return settings;
    });
    ipcMain.handle("quota:get-health", () => client.getHealth());
    ipcMain.handle("quota:get-account-usage", () => client.getAccountUsage());
    ipcMain.handle("quota:get-provider-usage", () => client.getProviderUsage());
  }

  async function createWindow() {
    settingsFile = path.join(app.getPath("userData"), "state.json");
    settings = readSettings(settingsFile);
    client = new QuotaClient({ demo: isDemo });
    client.start();
    registerIpc();
    createTray();
    overlayWindow = new BrowserWindow({
      ...boundsFor(settings.expanded),
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
    overlayWindow.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      setOverlayEnabled(false);
    });
    overlayWindow.on("closed", () => {
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
    tray?.destroy();
    tray = undefined;
    client?.stop();
  });
  app.on("window-all-closed", (event) => {
    if (!isQuitting) event.preventDefault();
  });
  app.on("activate", () => {
    if (settings) setOverlayEnabled(true);
  });
}
