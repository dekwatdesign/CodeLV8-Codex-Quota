import electronUpdater from "electron-updater";

export const GITHUB_UPDATE_CONFIG = Object.freeze({
  provider: "github",
  owner: "dekwatdesign",
  repo: "CodeLV8-Codex-Quota",
  releaseType: "release",
});

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Unknown update error");
}

function versionFromInfo(info) {
  const version = info && typeof info.version === "string" ? info.version.trim() : "";
  return version || undefined;
}

function updateInfoFields(info) {
  if (!info || typeof info !== "object") return {};
  return {
    version: versionFromInfo(info),
    releaseName: typeof info.releaseName === "string" ? info.releaseName : undefined,
    releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : undefined,
  };
}

/**
 * สร้างตัวจัดการอัปเดตที่ห่อ electron-updater ไว้ให้ main process เรียกใช้
 * และส่งเฉพาะสถานะที่ปลอดภัยไปยัง renderer
 */
export function createUpdateManager({
  appVersion = "",
  isPackaged = false,
  platform = process.platform,
  enabled = true,
  updater,
  onStateChange,
  checkIntervalMs = UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  const supported = enabled && isPackaged && platform === "win32";
  let updaterInstance = updater;
  let state = Object.freeze({
    status: supported ? "idle" : "disabled",
    currentVersion: appVersion || undefined,
  });
  let started = false;
  let checkPromise;
  let timer;

  function getUpdater() {
    if (!updaterInstance) updaterInstance = electronUpdater.autoUpdater;
    return updaterInstance;
  }

  const listeners = [
    ["checking-for-update", () => publish({ status: "checking", error: undefined })],
    ["update-available", (info) => publish({ status: "available", error: undefined, ...updateInfoFields(info) })],
    ["update-not-available", (info) => publish({
      status: "up-to-date",
      error: undefined,
      checkedAt: new Date().toISOString(),
      ...updateInfoFields(info),
    })],
    ["download-progress", (progress) => publish({
      status: "downloading",
      percent: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : undefined,
      bytesPerSecond: Number.isFinite(progress?.bytesPerSecond) ? progress.bytesPerSecond : undefined,
      transferred: Number.isFinite(progress?.transferred) ? progress.transferred : undefined,
      total: Number.isFinite(progress?.total) ? progress.total : undefined,
      error: undefined,
    })],
    ["update-downloaded", (info) => publish({
      status: "downloaded",
      percent: 100,
      error: undefined,
      ...updateInfoFields(info),
    })],
    ["update-cancelled", (info) => publish({ status: "idle", error: undefined, ...updateInfoFields(info) })],
    ["error", (error) => publish({ status: "error", error: errorMessage(error), checkedAt: new Date().toISOString() })],
  ];

  function publish(next) {
    state = Object.freeze({
      ...state,
      ...next,
      currentVersion: state.currentVersion || appVersion || undefined,
    });
    onStateChange?.(state);
    return state;
  }

  function configure() {
    const activeUpdater = getUpdater();
    activeUpdater.autoDownload = true;
    activeUpdater.autoInstallOnAppQuit = true;
    activeUpdater.allowPrerelease = false;
    activeUpdater.fullChangelog = false;
    activeUpdater.setFeedURL(GITHUB_UPDATE_CONFIG);
  }

  function attachListeners() {
    if (started) return;
    const activeUpdater = getUpdater();
    for (const [event, listener] of listeners) activeUpdater.on(event, listener);
    started = true;
  }

  function ensureStarted() {
    if (!supported) return false;
    if (started) return true;
    try {
      configure();
      attachListeners();
      return true;
    } catch (error) {
      publish({ status: "error", error: errorMessage(error), checkedAt: new Date().toISOString() });
      return false;
    }
  }

  async function check({ manual = false } = {}) {
    if (!supported) return state;
    if (!ensureStarted()) return state;
    if (checkPromise) return checkPromise;

    if (manual) publish({ status: "checking", error: undefined });
    checkPromise = Promise.resolve()
      .then(() => getUpdater().checkForUpdates())
      .then((result) => {
        if (!result) {
          return state.status === "checking"
            ? publish({ status: "idle", checkedAt: new Date().toISOString(), error: undefined })
            : state;
        }
        if (result.isUpdateAvailable && state.status === "checking") {
          return publish({ status: "available", error: undefined, ...updateInfoFields(result.updateInfo) });
        }
        if (!result.isUpdateAvailable && state.status === "checking") {
          return publish({ status: "up-to-date", checkedAt: new Date().toISOString(), error: undefined });
        }
        return state;
      })
      .catch((error) => publish({ status: "error", error: errorMessage(error), checkedAt: new Date().toISOString() }))
      .finally(() => {
        checkPromise = undefined;
      });
    return checkPromise;
  }

  function start() {
    if (!supported || started) return state;
    if (!ensureStarted()) return state;
    void check();
    timer = setInterval(() => void check(), checkIntervalMs);
    timer.unref?.();
    return state;
  }

  function install() {
    if (!supported || state.status !== "downloaded") return state;
    publish({ status: "installing", error: undefined });
    getUpdater().quitAndInstall(false, true);
    return state;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (started) {
      const activeUpdater = getUpdater();
      for (const [event, listener] of listeners) activeUpdater.removeListener(event, listener);
    }
    started = false;
  }

  return Object.freeze({
    start,
    stop,
    check,
    install,
    getState: () => state,
    isSupported: () => supported,
  });
}
