import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandOnPath, commandPathsOnPath, preferSpawnablePath } from "./spawnable-command.mjs";

const SHIM_MARKER = "MODEL_ROUTER_CODEX_SHIM";
const LINUX_DESKTOP_APP_ROOTS = ["/opt/codex-desktop"];

function isShimFile(candidate) {
  try {
    if (statSync(candidate).size > 64 * 1024) return false;
    return readFileSync(candidate, "utf8").includes(SHIM_MARKER);
  } catch {
    return false;
  }
}

export function linuxDesktopAppBundledCodex({
  platform = process.platform,
  roots = LINUX_DESKTOP_APP_ROOTS,
} = {}) {
  if (platform !== "linux") return undefined;
  return roots
    .map((root) => path.join(root, "resources", "codex"))
    .find((candidate) => existsSync(candidate) && !isShimFile(candidate));
}

function desktopAppBundledCodex({ platform = process.platform, localAppData = process.env.LOCALAPPDATA } = {}) {
  if (platform !== "win32" || !localAppData) return undefined;
  const binDir = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(binDir)) return undefined;
  try {
    return readdirSync(binDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binDir, entry.name, "codex.exe"))
      .filter((candidate) => existsSync(candidate) && !isShimFile(candidate))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

export function codexCandidatePaths({
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA,
  home = os.homedir(),
  linuxDesktopRoots,
} = {}) {
  const appRoot = localAppData && path.join(localAppData, "OpenAI", "Codex", "bin");
  return [
    process.env.CODEX_BIN,
    process.env.CODEX_CLI_PATH,
    process.env.CODEX_BINARY,
    process.env.CODEX_INSTALL_DIR &&
      path.join(process.env.CODEX_INSTALL_DIR, platform === "win32" ? "codex.exe" : "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    linuxDesktopAppBundledCodex({ platform, roots: linuxDesktopRoots }),
    "/usr/local/bin/codex",
    localAppData && path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
    localAppData && path.join(localAppData, "Programs", "Codex", "resources", "codex.exe"),
    localAppData && path.join(localAppData, "Programs", "Codex", "resources", "app", "bin", "codex.exe"),
    appRoot && path.join(appRoot, "codex.exe"),
    desktopAppBundledCodex({ platform, localAppData }),
    path.join(home, ".local", "bin", platform === "win32" ? "codex.exe" : "codex"),
  ].filter(Boolean);
}

function existingCandidates(paths) {
  return paths.filter((candidate) => existsSync(candidate) && !isShimFile(candidate));
}

export function resolveRealCodex({ platform = process.platform } = {}) {
  const paths = commandPathsOnPath("codex", { platform })
    .filter((candidate) => !isShimFile(candidate));
  return preferSpawnablePath(paths, platform) || undefined;
}

export function findCodexBinary({ platform = process.platform, localAppData, home } = {}) {
  const candidates = existingCandidates(codexCandidatePaths({ platform, localAppData, home }));
  const explicit = candidates.find((candidate) =>
    [process.env.CODEX_BIN, process.env.CODEX_CLI_PATH, process.env.CODEX_BINARY]
      .filter(Boolean)
      .some((configured) => path.resolve(configured) === path.resolve(candidate)),
  );
  if (explicit) return explicit;

  // เลือกไฟล์ที่อัปเดตล่าสุดจากชุดติดตั้ง Desktop เพื่อไม่ใช้ binary เก่าที่ค้างอยู่
  const desktopCandidates = candidates.filter((candidate) =>
    candidate.toLowerCase().includes(`${path.sep}openai${path.sep}codex${path.sep}bin${path.sep}`),
  );
  if (desktopCandidates.length) {
    return desktopCandidates
      .sort((left, right) => {
        try {
          return statSync(right).mtimeMs - statSync(left).mtimeMs;
        } catch {
          return 0;
        }
      })[0];
  }

  const found = commandOnPath("codex", { platform });
  if (found && !isShimFile(found)) return found;
  return resolveRealCodex({ platform });
}

export { isShimFile };
