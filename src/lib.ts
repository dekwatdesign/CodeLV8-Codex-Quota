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
