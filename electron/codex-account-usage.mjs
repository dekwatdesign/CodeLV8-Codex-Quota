import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";
import { findCodexBinary } from "./codex-binary.mjs";
import { spawnableCommand } from "./spawnable-command.mjs";

const DEFAULT_TIMEOUT_MS = 12_000;

function discoveryDisabled() {
  return process.argv.includes("--no-discovery") || process.env.CODEX_QUOTA_NO_DISCOVERY === "1";
}

function killProcessTree(child, viaShell) {
  if (!child) return;
  if (!viaShell || process.platform !== "win32" || !child.pid) {
    try { child.kill(); } catch { /* กระบวนการอาจหยุดไปแล้ว */ }
    return;
  }
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    try { child.kill(); } catch { /* กระบวนการอาจหยุดไปแล้ว */ }
  }
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function normalizeWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = clampPercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: Number.isFinite(window.windowDurationMins)
      ? window.windowDurationMins
      : null,
    resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
  };
}

function optionalTokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : undefined;
}

export function normalizeCodexAccountUsage(rateLimitResponse, usageResponse, now = new Date()) {
  const buckets = Array.isArray(usageResponse?.dailyUsageBuckets)
    ? usageResponse.dailyUsageBuckets
        .filter((bucket) =>
          typeof bucket?.startDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(bucket.startDate) &&
          Number.isFinite(Number(bucket.tokens)),
        )
        .map((bucket) => ({
          startDate: bucket.startDate,
          tokens: Math.max(0, Math.trunc(Number(bucket.tokens))),
          ...(optionalTokenCount(bucket.inputTokens) !== undefined
            ? { inputTokens: optionalTokenCount(bucket.inputTokens) }
            : {}),
          ...(optionalTokenCount(bucket.cachedInputTokens) !== undefined
            ? { cachedInputTokens: optionalTokenCount(bucket.cachedInputTokens) }
            : {}),
          ...(optionalTokenCount(bucket.outputTokens) !== undefined
            ? { outputTokens: optionalTokenCount(bucket.outputTokens) }
            : {}),
        }))
        .sort((left, right) => left.startDate.localeCompare(right.startDate))
    : [];
  const limits = rateLimitResponse?.rateLimits || {};
  const summary = usageResponse?.summary || {};
  return {
    fetchedAt: now.toISOString(),
    planType: typeof limits.planType === "string" ? limits.planType : null,
    limitId: typeof limits.limitId === "string" ? limits.limitId : null,
    primary: normalizeWindow(limits.primary),
    secondary: normalizeWindow(limits.secondary),
    dailyUsageBuckets: buckets,
    summary: {
      lifetimeTokens: Number.isFinite(Number(summary.lifetimeTokens)) ? Number(summary.lifetimeTokens) : null,
      peakDailyTokens: Number.isFinite(Number(summary.peakDailyTokens)) ? Number(summary.peakDailyTokens) : null,
      currentStreakDays: Number.isFinite(Number(summary.currentStreakDays)) ? Number(summary.currentStreakDays) : null,
    },
  };
}

export function readCodexAccountUsage({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  binary = findCodexBinary(),
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    if (discoveryDisabled()) {
      reject(new Error("Credential discovery is disabled (--no-discovery); the Codex account is not read."));
      return;
    }
    if (!binary) {
      reject(new Error("The Codex app-server could not be started: no Codex binary was found."));
      return;
    }

    let target;
    let processHandle;
    try {
      target = spawnableCommand(binary, ["app-server"], platform);
      processHandle = spawnImpl(target.command, target.args, {
        ...target.options,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const lines = readline.createInterface({ input: processHandle.stdout });
    const responses = new Map();
    let settled = false;
    let timer;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      killProcessTree(processHandle, Boolean(target.options.windowsVerbatimArguments));
      if (error) reject(error);
      else resolve(value);
    };

    const send = (message) => {
      try {
        processHandle.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };

    timer = setTimeout(
      () => finish(new Error("Codex account usage request timed out.")),
      timeoutMs,
    );

    processHandle.once("error", () => {
      finish(new Error("The Codex app-server could not be started."));
    });
    processHandle.once("exit", (code) => {
      if (!settled) finish(new Error(`Codex app-server exited before replying (${code ?? "signal"}).`));
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message?.id === 1) {
        if (message.error) {
          finish(new Error("Codex app-server initialization failed."));
          return;
        }
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "account/rateLimits/read", params: null });
        send({ id: 3, method: "account/usage/read", params: null });
        return;
      }
      if (message?.id !== 2 && message?.id !== 3) return;
      if (message.error) {
        if (message.id === 2) {
          finish(new Error("Codex account limits are unavailable for this login."));
          return;
        }
        responses.set(3, { summary: {}, dailyUsageBuckets: [] });
      } else {
        responses.set(message.id, message.result || {});
      }
      if (responses.size === 2) {
        finish(undefined, normalizeCodexAccountUsage(responses.get(2), responses.get(3)));
      }
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-quota",
          title: "Codex Quota",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
