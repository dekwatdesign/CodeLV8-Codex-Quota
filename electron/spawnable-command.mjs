import { execFileSync } from "node:child_process";

export const WINDOWS_SPAWNABLE_EXTENSIONS = [".exe", ".com", ".cmd", ".bat"];

export function preferSpawnablePath(paths, platform = process.platform) {
  const values = (paths || []).map((value) => String(value).trim()).filter(Boolean);
  if (platform !== "win32") return values[0];
  for (const extension of WINDOWS_SPAWNABLE_EXTENSIONS) {
    const match = values.find((value) => value.toLowerCase().endsWith(extension));
    if (match) return match;
  }
  return values[0];
}

export function commandOnPath(
  name,
  { platform = process.platform, exec = execFileSync } = {},
) {
  return preferSpawnablePath(commandPathsOnPath(name, { platform, exec }), platform) || undefined;
}

export function commandPathsOnPath(
  name,
  { platform = process.platform, exec = execFileSync } = {},
) {
  const finder = platform === "win32" ? "where.exe" : "which";
  try {
    const output = exec(finder, [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return String(output || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function isWindowsBatchShim(binary, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(String(binary || ""));
}

const CMD_SHIM_PATTERN = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;
const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;
const PATH_ILLEGAL_ON_WINDOWS = /["<>|?*\u0000-\u001f]/;
const SAFE_BARE_ARGUMENT = /^[A-Za-z0-9_@+=:.\/\\-]+$/;

export function needsDoubleEscape(binary) {
  return CMD_SHIM_PATTERN.test(String(binary || ""));
}

export function assertSpawnablePath(binary) {
  if (PATH_ILLEGAL_ON_WINDOWS.test(String(binary))) {
    throw new Error(
      "Refusing to run a Windows path containing characters no file name may hold. " +
        "Check CODEX_BIN, CODEX_CLI_PATH, or the configured Codex path.",
    );
  }
  return binary;
}

export function escapeWindowsShellCommand(value) {
  return String(value).replace(CMD_META_CHARACTERS, "^$1");
}

export function escapeWindowsShellArgument(value, doubleEscape = false) {
  let escaped = String(value);
  if (SAFE_BARE_ARGUMENT.test(escaped)) return escaped;
  escaped = escaped.replace(/(\\*)"/g, "$1$1\\\"");
  escaped = escaped.replace(/(\\*)$/, "$1$1");
  escaped = `"${escaped}"`;
  escaped = escaped.replace(CMD_META_CHARACTERS, "^$1");
  if (doubleEscape) escaped = escaped.replace(CMD_META_CHARACTERS, "^$1");
  return escaped;
}

export function spawnableCommand(binary, args = [], platform = process.platform) {
  const argumentList = [...args];
  if (!isWindowsBatchShim(binary, platform)) {
    return { command: binary, args: argumentList, options: {} };
  }
  assertSpawnablePath(binary);
  const line = [
    escapeWindowsShellCommand(binary),
    ...argumentList.map((argument) => escapeWindowsShellArgument(argument, needsDoubleEscape(binary))),
  ].join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}
