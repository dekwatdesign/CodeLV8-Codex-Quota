import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  expanded: false,
  startWithWindows: false,
});

function normalizePosition(value) {
  if (!value || typeof value !== "object") return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}

export function normalizeSettings(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const settings = {
    version: 1,
    enabled: value.enabled !== false,
    expanded: value.expanded === true,
    startWithWindows: value.startWithWindows === true,
  };
  const position = normalizePosition(value.position);
  if (position) settings.position = position;
  return settings;
}

export function readSettings(file) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(file, value) {
  const settings = normalizeSettings(value);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, file);
  return settings;
}
