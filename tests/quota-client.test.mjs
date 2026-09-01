import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  accountUsageFromSnapshot,
  mergeSparseSnapshot,
  QuotaClient,
  remainingPercent,
} from "../electron/quota-client.mjs";
import {
  normalizeCodexAccountUsage,
  readCodexAccountUsage,
} from "../electron/codex-account-usage.mjs";
import { normalizeSettings } from "../electron/state.mjs";
import { createUpdateManager, GITHUB_UPDATE_CONFIG } from "../electron/updater.mjs";

test("reports a starting state before the first Codex rate-limit snapshot", () => {
  const client = new QuotaClient({ command: "codex" });
  assert.equal(client.getHealth().activity.state, "starting");
});

test("merges sparse rate-limit updates without dropping existing windows", () => {
  const merged = mergeSparseSnapshot(
    { primary: { usedPercent: 8, resetsAt: 100 }, secondary: { usedPercent: 60 } },
    { primary: { resetsAt: 200 } },
  );
  assert.deepEqual(merged, {
    primary: { usedPercent: 8, resetsAt: 200 },
    secondary: { usedPercent: 60 },
  });
});

test("calculates clamped quota remaining percentages", () => {
  assert.equal(remainingPercent({ usedPercent: 8 }), 92);
  assert.equal(remainingPercent({ remainingPercent: 40 }), 40);
  assert.equal(remainingPercent({ remaining: 5, limit: 10 }), 50);
  assert.equal(remainingPercent({ usedPercent: 140 }), 0);
});

test("normalizes a persisted overlay position and startup setting", () => {
  assert.deepEqual(normalizeSettings({ enabled: true, expanded: true, position: { x: 128.7, y: "64" } }), {
    version: 1,
    enabled: true,
    expanded: true,
    startWithWindows: false,
    position: { x: 129, y: 64 },
  });
  assert.deepEqual(normalizeSettings({ enabled: false, startWithWindows: true, position: { x: "invalid", y: 20 } }), {
    version: 1,
    enabled: false,
    expanded: false,
    startWithWindows: true,
  });
});

test("normalizes account windows for the renderer", () => {
  const usage = accountUsageFromSnapshot({
    primary: { usedPercent: 8, windowDurationMins: 300 },
    secondary: { usedPercent: 60, windowDurationMins: 10_080 },
  }, "2026-08-27T00:00:00.000Z");
  assert.equal(usage.fetchedAt, "2026-08-27T00:00:00.000Z");
  assert.equal(usage.primary.label, "5-hour limit");
  assert.equal(usage.secondary.label, "Weekly limit");
});

test("keeps quota labels tied to the Codex window duration", () => {
  const usage = accountUsageFromSnapshot({
    primary: { label: "5-hour limit", usedPercent: 54, windowDurationMins: 10_080 },
    secondary: { label: "Weekly limit", usedPercent: 12, windowDurationMins: 300 },
  });
  assert.equal(usage.primary.label, "Weekly limit");
  assert.equal(usage.secondary.label, "5-hour limit");
  assert.equal(remainingPercent(usage.primary), 46);
  assert.equal(remainingPercent(usage.secondary), 88);
});

test("normalizes the account responses used by the Codex Router tray", () => {
  const usage = normalizeCodexAccountUsage(
    {
      rateLimits: {
        planType: "pro",
        limitId: "codex",
        primary: { usedPercent: 54, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_700_000_000 },
      },
    },
    {
      summary: { lifetimeTokens: 12_345, peakDailyTokens: 3_210, currentStreakDays: 4 },
      dailyUsageBuckets: [
        { startDate: "2026-07-20", tokens: 200 },
        { startDate: "invalid", tokens: 999 },
        { startDate: "2026-07-19", tokens: 100 },
      ],
    },
    new Date("2026-07-21T12:00:00.000Z"),
  );

  assert.equal(usage.primary.remainingPercent, 46);
  assert.equal(usage.secondary.remainingPercent, 88);
  assert.equal(usage.primary.resetsAt, 1_800_000_000);
  assert.equal(usage.secondary.resetsAt, 1_700_000_000);
  assert.deepEqual(usage.dailyUsageBuckets, [
    { startDate: "2026-07-19", tokens: 100 },
    { startDate: "2026-07-20", tokens: 200 },
  ]);
  assert.deepEqual(usage.summary, {
    lifetimeTokens: 12_345,
    peakDailyTokens: 3_210,
    currentStreakDays: 4,
  });
});

test("initializes the app-server before requesting both account payloads", async () => {
  let invocation;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = {
    write(payload) {
      const request = JSON.parse(payload);
      if (request.id === 1) {
        child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
      } else if (request.id === 2) {
        child.stdout.write(`${JSON.stringify({
          id: 2,
          result: {
            rateLimits: {
              primary: { usedPercent: 8, windowDurationMins: 300 },
              secondary: { usedPercent: 60, windowDurationMins: 10_080 },
            },
          },
        })}\n`);
      } else if (request.id === 3) {
        child.stdout.write(`${JSON.stringify({ id: 3, result: { dailyUsageBuckets: [] } })}\n`);
      }
    },
  };
  child.kill = () => true;

  const result = await readCodexAccountUsage({
    binary: "C:\\Users\\ann\\AppData\\Roaming\\npm\\codex.cmd",
    platform: "win32",
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      return child;
    },
  });

  assert.match(invocation.command, /cmd\.exe$/i);
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.equal(result.primary.remainingPercent, 92);
  assert.equal(result.secondary.remainingPercent, 40);
});

test("checks GitHub releases, tracks download progress, and installs a downloaded update", async () => {
  const updater = new EventEmitter();
  let feedConfig;
  let installArgs;
  updater.setFeedURL = (config) => { feedConfig = config; };
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "1.2.0", releaseName: "Codex Quota v1.2.0" });
    updater.emit("download-progress", { percent: 42, bytesPerSecond: 1000, transferred: 42, total: 100 });
    updater.emit("update-downloaded", { version: "1.2.0" });
    return { isUpdateAvailable: true };
  };
  updater.quitAndInstall = (...args) => { installArgs = args; };

  const states = [];
  const manager = createUpdateManager({
    appVersion: "1.1.0",
    isPackaged: true,
    platform: "win32",
    updater,
    checkIntervalMs: 60_000,
    onStateChange: (state) => states.push(state),
  });

  manager.start();
  await manager.check({ manual: true });
  assert.deepEqual(feedConfig, GITHUB_UPDATE_CONFIG);
  assert.equal(manager.getState().status, "downloaded");
  assert.equal(manager.getState().version, "1.2.0");
  assert.ok(states.some((state) => state.status === "downloading" && state.percent === 42));

  manager.install();
  assert.equal(manager.getState().status, "installing");
  assert.deepEqual(installArgs, [false, true]);
  manager.stop();
});

test("disables release checks outside a packaged Windows build", async () => {
  const manager = createUpdateManager({ appVersion: "1.1.0", isPackaged: false, platform: "win32" });
  assert.deepEqual(manager.getState(), { status: "disabled", currentVersion: "1.1.0" });
  assert.equal(manager.start().status, "disabled");
  assert.equal((await manager.check()).status, "disabled");
});
