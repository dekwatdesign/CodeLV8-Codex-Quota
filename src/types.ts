export interface UsageBucket {
  startDate: string;
  tokens: number;
  requests?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface UsageMetric {
  kind: "quota" | "balance" | string;
  label: string;
  usedPercent?: number;
  remainingPercent?: number;
  used?: number;
  limit?: number;
  remaining?: number;
  value?: number;
  currency?: string;
  unit?: string;
  detail?: string;
  resetAt?: number;
  resetsAt?: number;
  windowDurationMins?: number;
}

export interface AccountUsage {
  fetchedAt?: string;
  planType?: string;
  limitId?: string;
  primary?: UsageMetric | null;
  secondary?: UsageMetric | null;
  dailyUsageBuckets?: UsageBucket[];
  summary?: {
    lifetimeTokens?: number | null;
    peakDailyTokens?: number | null;
    currentStreakDays?: number | null;
  };
}

export interface ProviderModelUsage {
  slug?: string;
  displayName?: string;
  observedTokensPerSecond?: number | null;
}

export interface ProviderUsage {
  id: string;
  displayName: string;
  last24hRequests?: number;
  dailyUsageBuckets?: UsageBucket[];
  models?: ProviderModelUsage[];
}

export interface ProviderUsageSnapshot {
  fetchedAt?: string;
  providers: ProviderUsage[];
}

export interface ActiveRequest {
  id?: string;
  model?: string;
  provider?: string;
  sessionTitle?: string;
  sessionName?: string;
  isSubagent?: boolean;
}

export interface RouterHealth {
  ok: boolean;
  error?: string;
  activity?: {
    state?: string;
    activeCount?: number;
    active?: ActiveRequest[];
    model?: string;
    provider?: string;
  };
}

export interface OverlaySettings {
  version: 1;
  enabled: boolean;
  expanded: boolean;
  position?: {
    x: number;
    y: number;
  };
}

export interface RouterControlApi {
  readonly platform: string;
  getOverlaySettings(): Promise<OverlaySettings>;
  showOverlay(): Promise<OverlaySettings>;
  hideOverlay(): Promise<OverlaySettings>;
  setOverlayEnabled(enabled: boolean): Promise<OverlaySettings>;
  setOverlayExpanded(expanded: boolean): Promise<OverlaySettings>;
  startOverlayDrag?(): Promise<void>;
  moveOverlayBy?(deltaX: number, deltaY: number): Promise<void>;
  endOverlayDrag?(): Promise<void>;
  getHealth(): Promise<RouterHealth>;
  getAccountUsage(): Promise<AccountUsage>;
  getProviderUsage(): Promise<ProviderUsageSnapshot>;
  onOverlaySettings?(listener: (settings: OverlaySettings) => void): () => void;
}

declare global {
  interface Window {
    routerControl?: RouterControlApi;
  }
}
