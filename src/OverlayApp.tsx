import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Activity, AlertCircle, ChevronDown, ChevronUp, Gauge, Power, X, Zap } from "lucide-react";
import quotaIcon from "../assets/codex-quota.png";
import { remainingPercent } from "./lib";
import type { AccountUsage, ProviderUsageSnapshot, RouterControlApi, RouterHealth, UsageMetric } from "./types";
import "./overlay.css";

function compactNumber(value: number | undefined): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function modelLabel(value: string | undefined): string {
  if (!value) return "Codex";
  const last = value.split("/").at(-1) || value;
  return last.replace(/[-_]+/g, " ");
}

function providerLabel(value: string | undefined): string {
  if (!value) return "Native Codex";
  return value === "openai" ? "ChatGPT (native)" : value;
}

function stateLabel(state: string | undefined, activeCount: number): string {
  if (state === "offline") return "Codex offline";
  if (state === "error") return "Request error";
  if (state === "starting") return "Connecting to Codex";
  if (state === "generating" || activeCount > 0) return "Thinking";
  return "Idle";
}

function currentProviderUsage(usage: ProviderUsageSnapshot | undefined, provider: string | undefined) {
  if (!usage?.providers?.length) return undefined;
  return usage.providers.find((entry) => entry.id === provider)
    || usage.providers.find((entry) => (entry.last24hRequests || 0) > 0)
    || usage.providers[0];
}

function quotaTone(remaining: number): "green" | "yellow" | "red" {
  if (remaining > 80) return "green";
  if (remaining >= 60) return "yellow";
  return "red";
}

function quotaLabel(metric: UsageMetric | null | undefined, fallbackLabel: string): string {
  const minutes = Number(metric?.windowDurationMins);
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10_080) return "Weekly limit";
  if (minutes === 43_200) return "Monthly limit";
  if (metric?.label?.trim()) return metric.label.trim();
  return fallbackLabel;
}

function quotaMetric(metric: UsageMetric | null | undefined, fallbackLabel: string) {
  const remaining = metric ? remainingPercent(metric) : null;
  if (remaining === null) return undefined;
  return {
    label: quotaLabel(metric, fallbackLabel),
    remaining,
    tone: quotaTone(remaining),
  };
}

export default function OverlayApp() {
  const api = window.routerControl as RouterControlApi | undefined;
  const [health, setHealth] = useState<RouterHealth>();
  const [usage, setUsage] = useState<ProviderUsageSnapshot>();
  const [accountUsage, setAccountUsage] = useState<AccountUsage>();
  const [expanded, setExpanded] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const dragState = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    pending: Promise<void>;
  } | undefined>(undefined);

  const refreshHealth = useCallback(async () => {
    if (!api) return;
    try {
      setHealth(await api.getHealth());
      setLoadError(undefined);
    } catch (error) {
      setHealth({ ok: false, error: String(error), activity: { state: "offline", active: [], activeCount: 0 } });
      setLoadError("Status unavailable");
    }
  }, [api]);

  const refreshUsage = useCallback(async () => {
    if (!api) return;
    try {
      setUsage(await api.getProviderUsage());
    } catch {
      // ยังคงแสดงสถานะได้ แม้บันทึกการใช้งานจะกำลังถูกใช้งานอยู่
    }
  }, [api]);

  const refreshAccountUsage = useCallback(async () => {
    if (!api) return;
    try {
      setAccountUsage(await api.getAccountUsage());
    } catch {
      // หาก account meter ใช้งานไม่ได้ ให้คงข้อมูลกิจกรรมที่สังเกตไว้
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void Promise.all([refreshHealth(), refreshUsage(), refreshAccountUsage(), api.getOverlaySettings().then((settings) => {
      if (active) {
        setExpanded(settings.expanded);
        setStartWithWindows(settings.startWithWindows);
      }
    }).catch(() => undefined)]);
    const healthTimer = window.setInterval(() => void refreshHealth(), 750);
    const usageTimer = window.setInterval(() => void Promise.all([refreshUsage(), refreshAccountUsage()]), 30_000);
    return () => {
      active = false;
      window.clearInterval(healthTimer);
      window.clearInterval(usageTimer);
    };
  }, [api, refreshAccountUsage, refreshHealth, refreshUsage]);

  useEffect(() => api?.onOverlaySettings?.((settings) => {
    setExpanded(settings.expanded);
    setStartWithWindows(settings.startWithWindows);
  }), [api]);

  useEffect(() => {
    const theme = localStorage.getItem("model-router-control-center-theme");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  const activity = health?.activity;
  const activeRequests = activity?.active || [];
  const activeCount = activity?.activeCount || activeRequests.length;
  const active = activeRequests[0];
  const state = stateLabel(activity?.state, activeCount);
  const provider = active?.provider || activity?.provider;
  const model = active?.model || activity?.model;
  const providerUsage = currentProviderUsage(usage, provider);
  const todayTokens = providerUsage?.dailyUsageBuckets?.at(-1)?.tokens;
  const modelUsage = providerUsage?.models?.find((entry) => entry.slug === model)
    || providerUsage?.models?.find((entry) => entry.displayName === model);
  const speed = modelUsage?.observedTokensPerSecond;
  const quotaBars = [
    quotaMetric(accountUsage?.primary, "5-hour limit"),
    quotaMetric(accountUsage?.secondary, "Weekly limit"),
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const statusClass = activity?.state === "offline" ? "is-offline" : state === "Thinking" ? "is-active" : "is-idle";

  const toggleExpanded = async () => {
    const next = !expanded;
    setExpanded(next);
    try {
      await api?.setOverlayExpanded(next);
    } catch {
      setExpanded(!next);
    }
  };

  const toggleStartWithWindows = async () => {
    const next = !startWithWindows;
    setStartWithWindows(next);
    try {
      const settings = await api?.setStartWithWindows(next);
      if (settings) setStartWithWindows(settings.startWithWindows);
    } catch {
      setStartWithWindows(!next);
    }
  };

  const hide = async (event: MouseEvent) => {
    event.stopPropagation();
    await api?.hideOverlay();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void api?.hideOverlay();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, label, progress")) return;
    const start = api?.startOverlayDrag?.();
    dragState.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      pending: Promise.resolve(start).catch(() => undefined),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // การจับ pointer อาจไม่รองรับใน renderer บางโหมด
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (deltaX === 0 && deltaY === 0) return;
    drag.pending = drag.pending.then(async () => {
      await api?.moveOverlayBy?.(deltaX, deltaY);
    }).catch(() => undefined);
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragState.current = undefined;
    void drag.pending.then(async () => {
      await api?.endOverlayDrag?.();
    }).catch(() => undefined);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture อาจถูกปล่อยไปแล้ว
    }
  };

  const summary = useMemo(() => {
    if (active?.sessionName || active?.sessionTitle) return active.sessionName || active.sessionTitle;
    if (loadError) return loadError;
    return `${providerLabel(provider)} · ${modelLabel(model)}`;
  }, [active?.sessionName, active?.sessionTitle, loadError, model, provider]);

  return (
    <main
      className={`overlay-surface ${expanded ? "is-expanded" : ""}`}
      role="dialog"
      aria-label="Codex Quota activity overlay"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="overlay-card">
        <div className="overlay-header">
          <div className={`overlay-status-dot ${statusClass}`} aria-hidden="true"><i /></div>
          <span className="overlay-state">{state}</span>
          <span className="overlay-brand"><img src={quotaIcon} alt="" aria-hidden="true" />Codex Quota</span>
          <button className="overlay-icon-button" type="button" title="Hide activity overlay" aria-label="Hide activity overlay" onClick={(event) => void hide(event)}>
            <X aria-hidden size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="overlay-summary">
          {quotaBars.length ? (
            <div className="overlay-quotas" aria-label="Quota limits">
              <div className="overlay-detail-heading"><span>Quota remaining</span><small>account limits</small></div>
              {quotaBars.map((quota) => (
                <div className="overlay-quota-row" key={quota.label}>
                  <div className="overlay-quota-label"><span>{quota.label}</span><strong>{Math.round(quota.remaining)}%</strong></div>
                  <progress
                    className={`overlay-quota-bar tone-${quota.tone}`}
                    max="100"
                    value={quota.remaining}
                    aria-label={`${quota.label}: ${Math.round(quota.remaining)} percent remaining`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="overlay-summary-copy">
              <strong title={summary}>{summary}</strong>
              <small title={model || undefined}>{providerLabel(provider)} · {modelLabel(model)}</small>
            </div>
          )}
          <button
            className="overlay-expand-button"
            type="button"
            title={expanded ? "Collapse activity details" : "Expand activity details"}
            aria-label={expanded ? "Collapse activity details" : "Expand activity details"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              void toggleExpanded();
            }}
          >
            {expanded ? <ChevronUp aria-hidden size={18} strokeWidth={2} /> : <ChevronDown aria-hidden size={18} strokeWidth={2} />}
          </button>
        </div>

        <div className="overlay-metrics" aria-label="Codex activity metrics">
          <div><Activity aria-hidden size={14} /><span>{activeCount} active</span></div>
          <div><Zap aria-hidden size={14} /><span>{compactNumber(todayTokens)} today</span></div>
          <div><Gauge aria-hidden size={14} /><span>{speed ? `${speed.toFixed(1)} t/s` : "— t/s"}</span></div>
        </div>

        {expanded ? (
          <div className="overlay-details">
            <div className="overlay-detail-heading"><span>Live requests</span><small>{providerUsage?.last24hRequests || 0} today</small></div>
            {activeRequests.length ? activeRequests.slice(0, 3).map((request, index) => (
              <div className="overlay-request" key={request.id || `${request.model}-${index}`}>
                <span className="overlay-request-pulse" aria-hidden="true" />
                <div><strong>{request.sessionName || request.sessionTitle || "Active Codex task"}</strong><small>{providerLabel(request.provider)} · {modelLabel(request.model)}{request.isSubagent ? " · subagent" : ""}</small></div>
              </div>
            )) : (
              <div className="overlay-empty"><AlertCircle aria-hidden size={14} /><span>No active requests</span></div>
            )}
            {api?.platform === "win32" ? (
              <div className="overlay-settings">
                <div className="overlay-detail-heading"><span>การตั้งค่า</span><small>Windows</small></div>
                <button
                  className={`overlay-startup-toggle ${startWithWindows ? "is-on" : ""}`}
                  type="button"
                  title="เปิดหรือปิดการเริ่มพร้อม Windows"
                  aria-label="เริ่มพร้อม Windows"
                  aria-pressed={startWithWindows}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleStartWithWindows();
                  }}
                >
                  <Power aria-hidden size={14} strokeWidth={2} />
                  <span>เริ่มพร้อม Windows</span>
                  <strong>{startWithWindows ? "เปิด" : "ปิด"}</strong>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
