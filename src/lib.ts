import type { UsageMetric } from "./types";

export function remainingPercent(metric: UsageMetric): number | null {
  if (Number.isFinite(Number(metric.remainingPercent))) {
    return Math.max(0, Math.min(100, Number(metric.remainingPercent)));
  }
  if (Number.isFinite(Number(metric.usedPercent))) {
    return Math.max(0, Math.min(100, 100 - Number(metric.usedPercent)));
  }
  if (Number.isFinite(Number(metric.remaining)) && Number.isFinite(Number(metric.limit)) && Number(metric.limit) > 0) {
    return Math.max(0, Math.min(100, (Number(metric.remaining) / Number(metric.limit)) * 100));
  }
  return null;
}

function resetTimestamp(metric: UsageMetric | null | undefined): number | null {
  if (!metric) return null;
  for (const value of [metric.resetsAt, metric.resetAt]) {
    if (value === null || value === undefined) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return milliseconds;
  }
  return null;
}

export function resetTimeLabel(metric: UsageMetric | null | undefined): string | null {
  const timestamp = resetTimestamp(metric);
  if (timestamp === null) return null;
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
  return `Resets at ${formatted}`;
}
