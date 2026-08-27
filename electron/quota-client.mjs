import { readCodexAccountUsage } from "./codex-account-usage.mjs";

const REFRESH_MS = 45_000;

export function mergeSparseSnapshot(current, update) {
  const result = { ...(current && typeof current === "object" ? current : {}) };
  if (!update || typeof update !== "object") return result;
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeSparseSnapshot(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function remainingPercent(metric) {
  if (!metric || typeof metric !== "object") return null;
  if (Number.isFinite(Number(metric.remainingPercent))) {
    return Math.max(0, Math.min(100, Number(metric.remainingPercent)));
  }
  if (Number.isFinite(Number(metric.usedPercent))) {
    return Math.max(0, Math.min(100, 100 - Number(metric.usedPercent)));
  }
  if (
    Number.isFinite(Number(metric.remaining)) &&
    Number.isFinite(Number(metric.limit)) &&
    Number(metric.limit) > 0
  ) {
    return Math.max(0, Math.min(100, (Number(metric.remaining) / Number(metric.limit)) * 100));
  }
  return null;
}

function windowLabel(window, fallback) {
  const minutes = Number(window?.windowDurationMins);
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10_080) return "Weekly limit";
  if (minutes === 43_200) return "Monthly limit";
  const explicit = typeof window?.label === "string" && window.label.trim()
    ? window.label.trim()
    : undefined;
  if (explicit) return explicit;
  return fallback;
}

function quotaWindow(window, fallback) {
  if (!window || typeof window !== "object") return null;
  return {
    ...window,
    kind: "quota",
    label: windowLabel(window, fallback),
  };
}

export function accountUsageFromSnapshot(snapshot, fetchedAt = new Date().toISOString()) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    fetchedAt,
    planType: source.planType || source.plan || undefined,
    limitId: source.limitId || undefined,
    primary: quotaWindow(source.primary, "5-hour limit"),
    secondary: quotaWindow(source.secondary, "Weekly limit"),
    dailyUsageBuckets: Array.isArray(source.dailyUsageBuckets) ? source.dailyUsageBuckets : [],
    summary: source.summary && typeof source.summary === "object" ? source.summary : undefined,
  };
}

export function demoAccountUsage() {
  return accountUsageFromSnapshot({
    planType: "ChatGPT",
    primary: { usedPercent: 8, windowDurationMins: 300 },
    secondary: { usedPercent: 60, windowDurationMins: 10_080 },
  });
}

export class QuotaClient {
  constructor({ command, demo = false } = {}) {
    this.command = command;
    this.demo = demo;
    this.snapshot = null;
    this.lastReadAt = null;
    this.lastError = demo ? null : "Connecting to Codex";
    this.refreshTimer = null;
    this.refreshing = null;
  }

  start() {
    if (this.demo || this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, REFRESH_MS);
    void this.refresh().catch(() => undefined);
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async refresh() {
    if (this.demo) {
      this.snapshot = {
        planType: "ChatGPT",
        primary: { usedPercent: 8, windowDurationMins: 300 },
        secondary: { usedPercent: 60, windowDurationMins: 10_080 },
      };
      this.lastReadAt = new Date().toISOString();
      this.lastError = null;
      return accountUsageFromSnapshot(this.snapshot, this.lastReadAt);
    }
    if (this.refreshing) return this.refreshing;

    const operation = (async () => {
      try {
        const account = await readCodexAccountUsage({ binary: this.command });
        this.snapshot = account;
        this.lastReadAt = account.fetchedAt;
        this.lastError = null;
        return accountUsageFromSnapshot(this.snapshot, this.lastReadAt);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    })();
    this.refreshing = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshing === operation) this.refreshing = null;
    }
  }

  async getAccountUsage() {
    if (!this.snapshot && !this.demo) await this.refresh();
    if (this.demo) return demoAccountUsage();
    return accountUsageFromSnapshot(this.snapshot, this.lastReadAt || undefined);
  }

  getProviderUsage() {
    return {
      fetchedAt: this.lastReadAt || undefined,
      providers: [{
        id: "codex",
        displayName: "Codex",
        dailyUsageBuckets: this.snapshot?.dailyUsageBuckets || [],
      }],
    };
  }

  getHealth() {
    const ok = Boolean(this.demo || this.snapshot) && !this.lastError;
    const state = ok
      ? "idle"
      : this.lastError === "Connecting to Codex" ? "starting" : "offline";
    return {
      ok,
      error: this.lastError || undefined,
      activity: { state, activeCount: 0, active: [] },
    };
  }
}
