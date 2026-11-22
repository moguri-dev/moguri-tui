import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MoguriError } from "@moguri-dev/sdk";
import { fixtureProvider, reviewNativeTools, waitFor } from "./fixture.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";

const terms = "is:issue is:open (UI OR UX OR redesign OR polish)";
const exec = promisify(execFile);
const issue = (number: number, pull = false) => ({
  id: number + 100, number, title: `Generated search ${number}`, body: "Generated untrusted search body.", state: "open",
  repository_url: "https://api.github.com/repos/generated-owner/fixture",
  html_url: `https://github.com/generated-owner/fixture/${pull ? "pull" : "issues"}/${number}`,
  ...(pull ? { pull_request: { url: `https://api.github.com/repos/generated-owner/fixture/pulls/${number}` } } : {}),
});

test("the SDK searches the exact authenticated private repository and preserves complete page receipts and issue/PR kinds", async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope);
    const exact = await f.sdk.github.search(f.scope, project.repository, project.account, terms);
    assert.equal(exact.accountId, project.accountId); assert.equal(exact.boundary, "controller-gh-account-not-ssh");
    assert.equal(exact.items[0]?.kind, "issue"); assert.equal(exact.nextPage, null);
    const endpoint = f.calls.find((call) => call.path.startsWith("search/issues?"))!;
    assert.equal(new URL(`https://api.github.com/${endpoint.path}`).searchParams.get("q"), `repo:${project.repository} (${terms})`);
    f.setSearch({ items: [issue(7), issue(11, true)] });
    const first = await f.sdk.github.search(f.scope, project.repository, project.account, "is:open (UI OR UX)", 1, 1);
    const second = await f.sdk.github.search(f.scope, project.repository, project.account, "is:open (UI OR UX)", first.nextPage!, 1);
    assert.equal(first.items[0]?.kind, "issue"); assert.equal(first.nextPage, 2);
    assert.equal(second.items[0]?.kind, "pull"); assert.equal(second.nextPage, null);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("the compiled CLI searches through its actual scoped SDK/service without a login, model or mutation", async () => {
  const f = await githubApplicationFixture();
  try {
    const result = await exec(process.execPath, ["dist/cli.mjs", "github", "search", terms, "--project", f.projectId, "--session", f.sessionId], {
      env: { ...process.env, MOGURI_STATE_DIR: f.stateDir }, timeout: 10_000,
    });
    const page = JSON.parse(result.stdout);
    assert.equal(page.type, "github.browse"); assert.equal(page.resource, "search");
    assert.equal(page.account, "generated-owner"); assert.equal(page.items[0]?.number, 7);
    assert.equal(f.session().turnId, null); assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("search denies scope overrides and unavailable pages before dispatching a search request", async () => {
  const f = await githubApplicationFixture();
  try {
    const project = await f.sdk.github.project(f.scope);
    for (const query of ["repo:outside/generated", "(org:outside)", "-user:outside", "UI OR(repo:outside/generated)"]) {
      await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, query), { code: "github_search_scope" });
    }
    await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, "  "), { code: "github_search_query" });
    for (const query of ["is:issue) OR is:pr (", "\"Generated unclosed phrase", "UI\\) OR UX"]) {
      await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, query), { code: "github_search_query" });
    }
    await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, terms, 11, 100), { code: "github_search_limit" });
    assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 0);
  } finally { await f.close(); }
});

test("incomplete, oversized, foreign and inconsistent GitHub search results never become complete empty evidence", async (t) => {
  const cases = [
    { name: "incomplete", value: { incomplete: true }, code: "github_incomplete" },
    { name: "missing count", value: { omitTotal: true }, code: "github_incomplete" },
    { name: "invalid count", value: { total: -1 }, code: "github_incomplete" },
    { name: "API ceiling", value: { total: 1001 }, code: "github_search_limit" },
    { name: "missing next receipt", value: { total: 31, next: false }, code: "github_incomplete" },
    { name: "different repository", value: { items: [{ ...issue(7), repository_url: "https://api.github.com/repos/outside/generated" }] }, code: "github_search_scope" },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const f = await githubApplicationFixture();
    try {
      const project = await f.sdk.github.project(f.scope); f.setSearch(scenario.value);
      await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, terms), { code: scenario.code });
      assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
    } finally { await f.close(); }
  });
});

test("an actual Autopilot worker discovers authenticated GitHub reads and never asks permission for qualified calls", { timeout: 20_000 }, async () => {
  const provider = await fixtureProvider({ respond: (_request, index) => index === 1 ?
    { tool: { name: "discover_tools", args: { query: "github_read" } } } : index === 2 ?
      { tool: { name: "github_read", args: { action: "project" } } } : index === 3 ?
        { tool: { name: "github_read", args: { action: "browse", input: { resource: "search", repository: "generated-owner/fixture",
          account: "generated-owner", query: terms, page: 1, perPage: 30 } } } } : { text: "Generated authenticated result inspected." } });
  const f = await githubApplicationFixture({ provider: provider.provider });
  try {
    await reviewNativeTools(f.sdk, ["discover_tools", "github_read"]);
    await f.sdk.sessions.selectModel(f.sessionId, provider.modelId); await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated private GitHub search.", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, delivery: "queue" });
    await waitFor(() => ["completed", "failed", "partial", "waiting_approval"].includes(f.session().status));
    assert.equal(f.session().status, "completed", JSON.stringify(f.session().messages));
    assert.equal(f.session().pendingApproval, null); assert.equal(provider.requests.length, 4);
    assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 1);
    assert.ok(f.session().messages.some((message) => message.role === "tool" && message.text.includes("Generated issue")));
    const decisions = f.service.controller.events(0).filter((event) => event.event_type === "tool.decided");
    assert.equal(decisions.length, 3);
    assert.equal(decisions.filter((event) => event.event_type === "tool.decided" && event.payload.actor === "autonomy").length, 2);
    assert.equal(decisions.filter((event) => event.event_type === "tool.decided" && event.payload.actor === "policy").length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); await provider.close(); }
});

test("authenticated search preserves access failures rather than switching an account or replaying a read", async () => {
  let attempts = 0;
  const f = await githubApplicationFixture({ beforeRead: async (path) => {
    if (path.startsWith("search/issues?")) { attempts++; throw new MoguriError("program_failed", "Generated authenticated GitHub HTTP 422 permission or query failure.", 409); }
  } });
  try {
    const project = await f.sdk.github.project(f.scope);
    await assert.rejects(() => f.sdk.github.search(f.scope, project.repository, project.account, terms), /HTTP 422/);
    assert.equal(attempts, 1); assert.equal(f.session().turnId, null); assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("the declared GitHub tool rejects another repository or login before search and retains the original partial job", async (t) => {
  for (const changes of [{ repository: "outside/generated" }, { account: "another-generated-user" }]) await t.test(JSON.stringify(changes), async () => {
    const f = await githubApplicationFixture();
    try {
      await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
      const tool = (await f.sdk.tools.catalog(f.sessionId, "github_read")).tools.find((tool) => tool.name === "github_read")!;
      assert.ok(tool);
      const input = { resource: "search", repository: "generated-owner/fixture", account: "generated-owner", query: terms, page: 1, perPage: 30 };
      const admitted = await f.sdk.tools.execute(f.sessionId, tool.name, { action: "browse", input: { ...input, ...changes } }, tool.schemaDigest);
      const failed = await waitFor(() => {
        const job = f.service.controller.snapshot().jobs.find((job) => job.id === admitted.id);
        return job && ["completed", "failed", "partial", "cancelled"].includes(job.status) ? job : false;
      });
      assert.equal(failed.status, "partial"); assert.match(failed.error ?? "", /exact project's discovered repository and account/);
      assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 0);
      await assert.rejects(() => f.sdk.tools.execute(f.sessionId, tool.name, { action: "project" }, tool.schemaDigest), { code: "workspace_unconfirmed" });
      assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
    } finally { await f.close(); }
  });
});

test("project-free chats do not acquire authenticated project GitHub tools or borrow a checkout", async () => {
  const f = await githubApplicationFixture();
  try {
    const home = await f.sdk.sessions.create(null, "Generated isolated Home chat");
    assert.equal((await f.sdk.tools.catalog(home.id!, "github_read")).tools.some((tool) => tool.name === "github_read"), false);
    assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 0);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("a permission change during an authenticated search discards its original response without replay", async () => {
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
  const f = await githubApplicationFixture({ beforeRead: async (path) => { if (path.startsWith("search/issues?")) { entered.resolve(); await gate.promise; } } });
  try {
    const project = await f.sdk.github.project(f.scope);
    const pending = f.sdk.github.search(f.scope, project.repository, project.account, terms);
    const refused = assert.rejects(pending, { code: "github_stale" });
    await entered.promise;
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
      tools: [...settings.values.permissions.tools, { id: "generated-search-denial", tool: "github", pathPrefix: "", decision: "deny" }] } }, settings.revision);
    gate.resolve(); await refused;
    assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { gate.resolve(); await f.close(); }
});

test("aborting the original SDK search reaches the owned read and never starts a replacement", async () => {
  const entered = Promise.withResolvers<void>(), stopped = Promise.withResolvers<void>();
  const f = await githubApplicationFixture({ beforeRead: async (path, signal) => {
    if (path.startsWith("search/issues?")) {
      entered.resolve();
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { stopped.resolve(); reject(signal.reason); }, { once: true }));
    }
  } });
  try {
    const project = await f.sdk.github.project(f.scope), abort = new AbortController();
    const pending = f.sdk.github.search(f.scope, project.repository, project.account, terms, 1, 30, abort.signal);
    const rejected = assert.rejects(pending, /abort|Generated original search stopped/i);
    await entered.promise; abort.abort(new Error("Generated original search stopped."));
    await rejected; await stopped.promise;
    assert.equal(f.calls.filter((call) => call.path.startsWith("search/issues?")).length, 1);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});
