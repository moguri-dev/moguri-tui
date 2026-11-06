import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { githubPrCiState, MoguriError, type GithubItem } from "../packages/protocol/src/index.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { AttentionNotifier, type Banner } from "../apps/desktop/src/notifications.ts";
import { execFile, execFileSync } from "node:child_process";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { integrationCommand } from "../apps/cli/src/integrations.ts";

test("the exact selected PR discovers its retained watch across SDK views without relinking or another job", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  let reopened: MoguriSdk | undefined;
  try {
    const project = await f.sdk.github.project(f.scope);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    assert.equal((await f.sdk.github.ci(f.scope, source)).watches.length, 0);
    const review = await f.sdk.github.previewCi(f.scope, source, { headSha: f.git(["rev-parse", "HEAD"]), timeoutMs: 1000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    assert.ok(started.id);
    const completed = await f.sdk.github.wait(started.id, { timeoutMs: 5000 });
    assert.equal(completed.result?.ci?.state, "success");
    reopened = await new MoguriSdk(f.service.connection).ready();
    const retained = await reopened.github.ci(f.scope, source);
    assert.equal(retained.currentWatchId, started.id);
    assert.equal(retained.watches.length, 1);
    assert.equal(retained.watches[0]?.ci?.target.number, 11);
    assert.equal(retained.watches[0]?.ci?.target.accountId, project.accountId);
    assert.equal(retained.watches[0]?.ci?.target.headSha, retained.item.headSha);
    assert.equal(f.session().prUrl, null);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { reopened?.disconnect(); await f.close(); }
});

test("concurrent independently reviewed views reuse one exact PR watcher and never create duplicate pollers", { timeout: 30_000 }, async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const f = await githubApplicationFixture({ beforeRead: async (path) => { if (path.includes("/check-runs?")) await held; } });
  let other: MoguriSdk | undefined;
  try {
    other = await new MoguriSdk(f.service.connection).ready();
    const project = await f.sdk.github.project(f.scope);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    const [left, right] = await Promise.all([
      f.sdk.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 }),
      other.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 }),
    ]);
    const [first, second] = await Promise.all([
      f.sdk.github.execute(left, left.document.confirmations, true),
      other.github.execute(right, right.document.confirmations, true),
    ]);
    assert.equal(first.id, second.id);
    assert.equal((await other.github.ci(f.scope, source)).watches.length, 1);
    release();
    assert.equal((await f.sdk.github.wait(first.id!, { timeoutMs: 5000 })).operation.status, "completed");
    assert.equal(f.calls.filter((call) => call.path.includes("/check-runs?")).length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { release(); other?.disconnect(); await f.close(); }
});

test("a live watch retains its complete original observation and stops when that PR changes head", { timeout: 30_000 }, async () => {
  let reached!: () => void, release!: () => void;
  const polling = new Promise<void>((resolve) => { reached = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const f = await githubApplicationFixture({ github: { wait: async (_ms, signal) => {
    reached(); await held; signal.throwIfAborted();
  } } });
  try {
    const project = await f.sdk.github.project(f.scope), originalHead = f.git(["rev-parse", "HEAD"]);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    f.setCi({ checks: [{ id: 82, name: "Generated running check", status: "in_progress", conclusion: null, head_sha: originalHead }], runs: [], statuses: [] });
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 2000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    await polling;
    const live = await f.sdk.github.read(started.id!);
    assert.equal(live.ciObservation?.state, "running");
    assert.equal(live.ciObservation?.items.length, 1);
    assert.equal(live.ciObservation?.target.headSha, originalHead);
    f.changeHead("c".repeat(40)); release();
    const stopped = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    assert.equal(stopped.operation.status, "failed");
    assert.equal(stopped.ciObservation?.target.headSha, originalHead);
    assert.equal(stopped.ciObservation?.state, "running");
    const current = await f.sdk.github.ci(f.scope, source);
    assert.equal(current.currentWatchId, null);
    assert.equal(current.watches.length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { release(); await f.close(); }
});

test("incomplete or duplicate declared CI collections never become a complete green observation", { timeout: 30_000 }, async (t) => {
  for (const variant of ["partial-count", "invalid-count", "duplicate"] as const) await t.test(variant, async () => {
    const f = await githubApplicationFixture();
    try {
      const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
      const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
      const check = { id: 82, name: "Generated check", status: "completed", conclusion: "success", head_sha: head };
      f.setCi({ checks: variant === "duplicate" ? [check, check] : [check], runs: [], statuses: [],
        checkCount: variant === "partial-count" ? 2 : variant === "invalid-count" ? null : 2 });
      const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 });
      const started = await f.sdk.github.execute(review, review.document.confirmations, true);
      const stopped = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
      assert.equal(stopped.operation.status, "failed");
      assert.equal(stopped.ciObservation, undefined);
      assert.equal(stopped.result, null);
      assert.match(stopped.operation.diagnostic!, /collection|complete|count|duplicate/i);
      assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
    } finally { await f.close(); }
  });
});

test("owned watch cancellation preserves observations and never labels failed cleanup acknowledged", { timeout: 30_000 }, async (t) => {
  for (const failedCleanup of [false, true]) await t.test(failedCleanup ? "unconfirmed cleanup" : "acknowledged stop", async () => {
    let reached!: () => void;
    const polling = new Promise<void>((resolve) => { reached = resolve; });
    const f = await githubApplicationFixture({ github: { wait: async (_ms, signal) => {
      reached();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(failedCleanup ? new MoguriError("program_partial", "Generated owned CI reader cleanup was unconfirmed.", 409) : signal.reason);
        signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      });
    } } });
    try {
      const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
      const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
      f.setCi({ checks: [{ id: 82, name: "Generated running check", status: "in_progress", conclusion: null, head_sha: head }], runs: [], statuses: [] });
      const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 5000, pollMs: 50 });
      const started = await f.sdk.github.execute(review, review.document.confirmations, true);
      await polling; await f.sdk.github.cancel(started.id!);
      const stopped = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
      assert.equal(stopped.operation.status, failedCleanup ? "partial" : "cancelled");
      assert.equal(stopped.operation.cancelRequested, true);
      assert.equal(stopped.operation.ci?.cleanupUnconfirmed ?? false, failedCleanup);
      assert.equal(stopped.ciObservation?.state, "running");
      assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
    } finally { await f.close(); }
  });
});

test("CI failure raises one private source-bound notification and marking it read never answers or restarts work", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    f.setCi({ checks: [{ id: 82, name: "Generated failed check", status: "completed", conclusion: "failure", head_sha: head }], runs: [], statuses: [] });
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    const finished = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    await f.sdk.refresh();
    const snapshot = f.sdk.getState().snapshot!, entries = snapshot.attention.filter((entry) => entry.reason === "ci");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.messageId, started.id);
    assert.equal(entries[0]?.operationRevision, finished.operation.revision);
    assert.equal(entries[0]?.source, "state");
    assert.equal(entries[0]?.kind, "bell");
    const visible = { ...snapshot, settings: { ...snapshot.settings, values: { ...snapshot.settings.values,
      notifications: { ...snapshot.settings.values.notifications, os: true, previewContent: false } } } };
    const shown: Banner[] = [], notifier = new AttentionNotifier(0), events = f.service.controller.events(0);
    notifier.observe(visible, events, false, (banner) => shown.push(banner));
    notifier.observe(visible, events, false, (banner) => shown.push(banner));
    assert.equal(shown.length, 1);
    assert.equal(shown[0]?.body, "A PR CI watch needs inspection.");
    const userMessages = f.session().messages.filter((message) => message.role === "user").length;
    await f.sdk.attention.acknowledge([entries[0]!.id]);
    assert.equal(f.sdk.getState().snapshot!.attention.find((entry) => entry.id === entries[0]!.id)?.active, true);
    assert.equal(f.session().pendingQuestionId, null);
    assert.equal(f.session().pendingApproval, null);
    assert.equal(f.session().messages.filter((message) => message.role === "user").length, userMessages);
    assert.equal((await f.sdk.github.ci(f.scope, source)).watches.length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("a captured CI view rejects a replaced checkout before accessing GitHub through that replacement root", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    await rename(f.root, join(f.directory, "original-checkout"));
    execFileSync("git", ["clone", "--quiet", f.remote, f.root], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    f.git(["remote", "set-url", "origin", f.repository.ssh_url]);
    const calls = f.calls.length;
    await assert.rejects(() => f.sdk.github.ci(f.scope, source, undefined, project.binding), /root|binding|source/i);
    assert.equal(f.calls.length, calls);
  } finally { await f.close(); }
});

test("CLI and shared TUI commands derive the same uniquely linked PR without repository or SHA re-entry", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope);
    const selected = await f.sdk.github.source(f.scope, { kind: "pull", repository: project.repository, account: project.account, accountId: project.accountId, number: 11 });
    await f.sdk.sessions.associatePr(f.sessionId, { ...selected.source, expectedDigest: selected.digest });
    const shared = await f.sdk.slash(f.sessionId, "/github ci-preview", "tui");
    assert.equal(shared.kind, "text");
    assert.ok(shared.kind === "text");
    const preview = JSON.parse(shared.text);
    assert.equal(preview.document.action.prNumber, 11);
    assert.equal(preview.document.action.headSha, selected.item.headSha);
    const cli = await integrationCommand(f.sdk, "github", "ci", [], { session: f.sessionId });
    assert.ok(typeof cli === "object" && cli !== null && "type" in cli && cli.type === "github.ci");
    assert.equal(f.session().pendingApproval, null);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("startup-failed checks retain canonical links and source diagnostics even when no job log exists", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    const url = "https://github.com/generated-owner/fixture/actions/runs/80/job/81";
    f.setCi({ checks: [{ id: 82, name: "Generated CI startup", status: "completed", conclusion: "failure", head_sha: head, html_url: url,
      output: { annotations_count: 1, summary: null, text: null } }], runs: [], statuses: [],
      annotations: [{ annotation_level: "failure", message: "Generated billing/spending eligibility gate: no job steps started.", title: "Generated startup failure" }] });
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 2000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    const result = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    assert.equal(result.ciObservation?.state, "failure");
    assert.equal(result.ciObservation?.items[0]?.url, url);
    assert.match(result.ciObservation?.items[0]?.body ?? "", /billing\/spending eligibility/);
    assert.ok(f.calls.some((call) => call.path.includes("/check-runs/82/annotations?")));
    assert.equal(f.calls.some((call) => call.path.endsWith("/logs")), false);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("PR classification never calls skipped, neutral, cancelled, timed-out or unknown observations successful", () => {
  const check: GithubItem = { kind: "check", id: 82, title: "Generated check", body: "", state: "completed", conclusion: "success",
    url: null, updatedAt: null, author: null, headSha: "a".repeat(40) };
  for (const [conclusion, expected] of [["skipped", "skipped"], ["neutral", "neutral"], ["cancelled", "cancelled"],
    ["timed_out", "timed-out"], [null, "unknown"], ["unrecognized", "unknown"], ["failure", "failure"], ["success", "success"]] as const) {
    assert.equal(githubPrCiState([{ ...check, conclusion }]), expected);
  }
  assert.equal(githubPrCiState([]), "no-checks");
  assert.equal(githubPrCiState([{ ...check, state: "queued", conclusion: null }]), "queued");
  assert.equal(githubPrCiState([{ ...check, state: "in_progress", conclusion: null }]), "running");
  assert.equal(githubPrCiState([{ ...check, kind: "status", state: "pending", conclusion: null }]), "pending");
  assert.equal(githubPrCiState([check, { ...check, id: 83, conclusion: "skipped" }]), "skipped");
});

test("no-checks and still-running deadlines retain actual observations without claiming GitHub timed out", { timeout: 30_000 }, async (t) => {
  for (const running of [false, true]) await t.test(running ? "running" : "no-checks", async () => {
    let clock = Date.now();
    const f = await githubApplicationFixture({ github: { now: () => clock, wait: async (_ms, signal) => { signal.throwIfAborted(); clock += 5000; } } });
    try {
      const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
      f.setCi({ checks: running ? [{ id: 82, name: "Generated pending", head_sha: head, status: "in_progress", conclusion: null }] : [], runs: [], statuses: [] });
      const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
      const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 5000, pollMs: 50 });
      const started = await f.sdk.github.execute(review, review.document.confirmations, true);
      const completed = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
      assert.equal(completed.operation.status, "completed");
      assert.equal(completed.ciObservation?.state, running ? "running" : "no-checks");
      assert.equal(completed.ciObservation?.deadlineReached, true);
      assert.equal(completed.result?.ci?.state, running ? "running" : "no-checks");
      assert.equal(completed.ciObservation?.items.length, running ? 1 : 0);
    } finally { await f.close(); }
  });
});

test("closed PR, changed numeric account and revoked access stop only the original watcher and retain its last evidence", { timeout: 30_000 }, async (t) => {
  for (const variant of ["closed", "account", "revoked", "rate-limit"] as const) await t.test(variant, async () => {
    let reached!: () => void, release!: () => void, fail = false;
    const polling = new Promise<void>((resolve) => { reached = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
    const f = await githubApplicationFixture({ beforeRead: async (path) => {
      if (fail && path === "user") throw new MoguriError("program_failed", `Generated GitHub HTTP ${variant === "rate-limit" ? 429 : 403}.`, 409);
    }, github: { wait: async (_ms, signal) => { reached(); await held; signal.throwIfAborted(); } } });
    try {
      const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
      f.setCi({ checks: [{ id: 82, name: "Generated pending", head_sha: head, status: "in_progress", conclusion: null }], runs: [], statuses: [] });
      const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
      const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 2000, pollMs: 50 });
      const started = await f.sdk.github.execute(review, review.document.confirmations, true); await polling;
      if (variant === "closed") f.closePull(11);
      else if (variant === "account") f.changeAccount(99);
      else fail = true;
      release();
      const stopped = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
      assert.equal(stopped.operation.status, "failed");
      assert.equal(stopped.ciObservation?.state, "running");
      assert.equal(stopped.operation.ci?.target.accountId, "generated-owner:42");
      assert.equal(f.calls.filter((call) => call.path.includes("/check-runs?")).length, 1);
      assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
    } finally { release(); await f.close(); }
  });
});

test("another view cannot use a missing original receipt to admit a second PR poller", { timeout: 30_000 }, async () => {
  let reached!: () => void, release!: () => void;
  const polling = new Promise<void>((resolve) => { reached = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
  const f = await githubApplicationFixture({ github: { wait: async (_ms, signal) => { reached(); await held; signal.throwIfAborted(); } } });
  try {
    const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
    f.setCi({ checks: [{ id: 82, name: "Generated pending", head_sha: head, status: "in_progress", conclusion: null }], runs: [], statuses: [] });
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true); await polling;
    const original = (await f.sdk.github.read(started.id!)).operation;
    f.service.controller.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", original.commandId);
    await assert.rejects(() => f.sdk.github.execute(review, review.document.confirmations, true), /no original admission receipt|no.*receipt/i);
    assert.equal(f.service.controller.snapshot().githubOperations.filter((operation) => operation.ci).length, 1);
    release(); await f.sdk.github.cancel(started.id!); await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
  } finally { release(); await f.close(); }
});

test("all exact-head check, status and run pages are retained before a PR can show observed success", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope), head = f.git(["rev-parse", "HEAD"]);
    f.setCi({ checkPages: [[{ id: 82, name: "Generated first", head_sha: head, status: "completed", conclusion: "success" }],
      [{ id: 83, name: "Generated second", head_sha: head, status: "completed", conclusion: "success" }]],
      statuses: [{ id: 84, context: "Generated status", state: "success" }],
      runPages: [[{ id: 80, name: "Generated first run", head_sha: head, status: "completed", conclusion: "success" }],
        [{ id: 81, name: "Generated second run", head_sha: head, status: "completed", conclusion: "success" }]] });
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 11 };
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 2000, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    const completed = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    assert.equal(completed.ciObservation?.state, "success");
    assert.equal(completed.ciObservation?.complete, true);
    assert.deepEqual(completed.ciObservation?.items.map((item) => `${item.kind}:${item.id}`).sort(), ["check:82", "check:83", "run:80", "run:81", "status:84"]);
    assert.ok(f.calls.some((call) => call.path.includes("/check-runs?") && call.path.includes("page=2")));
    assert.ok(f.calls.some((call) => call.path.includes("/actions/runs?") && call.path.includes("page=2")));
  } finally { await f.close(); }
});

test("a CI deadline with unconfirmed owned-reader cleanup stays partial instead of becoming a completed empty result", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture({ beforeRead: async (path, signal) => {
    if (!path.includes("/check-runs?")) return;
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(new MoguriError("program_partial", "Generated deadline could not confirm reader cleanup.", 409));
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    });
  } });
  try {
    const project = await f.sdk.github.project(f.scope), source = { kind: "pull" as const, number: 11,
      repository: project.repository, account: project.account, accountId: project.accountId };
    const review = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 100, pollMs: 50 });
    const started = await f.sdk.github.execute(review, review.document.confirmations, true);
    const stopped = await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    assert.equal(stopped.operation.status, "partial");
    assert.equal(stopped.operation.ci?.cleanupUnconfirmed, true);
    assert.equal(stopped.result, null);
    assert.equal(stopped.ciObservation, undefined);
  } finally { await f.close(); }
});

test("the compiled CLI reads exact session PR history through the shared CI API without a model", { timeout: 30_000 }, async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope), selected = await f.sdk.github.source(f.scope,
      { kind: "pull", repository: project.repository, account: project.account, accountId: project.accountId, number: 11 });
    await f.sdk.sessions.associatePr(f.sessionId, { ...selected.source, expectedDigest: selected.digest });
    const result = await promisify(execFile)(process.execPath, ["dist/cli.mjs", "github", "ci", "--session", f.sessionId], {
      cwd: process.cwd(), env: { ...process.env, MOGURI_STATE_DIR: f.stateDir }, timeout: 10000,
    });
    const view = JSON.parse(result.stdout);
    assert.equal(view.type, "github.ci"); assert.equal(view.source.number, 11); assert.equal(view.accountId, project.accountId);
    assert.equal(view.currentWatchId, null); assert.equal(view.watches.length, 0);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});
