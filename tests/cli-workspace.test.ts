import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("the CLI exposes shared working-window choices and holds exact long text as a scoped file without inference", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    await fixture.configure();
    const settings = JSON.parse((await execute(["slash", "/model-settings", "--session", fixture.sessionId])).stdout);
    assert.equal(settings.kind, "text");
    const context = JSON.parse(settings.text).context;
    assert.deepEqual(context.windows.values, [fixture.contextWindow, Math.floor(fixture.contextWindow / 2)]);
    const text = Array.from({ length: 51 }, (_, index) => `Generated CLI exact paste ${index}`).join("\r\n");
    const file = join(fixture.directory, "generated-cli-paste.txt"); await writeFile(file, text);
    await execute(["queue", "hold", file, "--session", fixture.sessionId]);
    const item = fixture.session().queue[0]!;
    assert.equal(item.held, true); assert.equal(item.text, ""); assert.equal(item.attachments[0]?.kind, "paste_file");
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, item.attachments[0]!.id)).content, { kind: "text", text });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the CLI manages profiles and uses explicit or inherited immutable scope without moving another client", async () => {
  const fixture = await profileFixture();
  const execute = (args: string[], profile = "default") => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: fixture.stateDir, MOGURI_PROFILE_ID: profile } });
  try {
    const first = await fixture.sdk.sessions.create(null, "Generated CLI Default");
    const profile = JSON.parse((await execute(["profile", "create", "Generated CLI Beta", "--color", "#557799"])).stdout);
    assert.equal(profile.status, "ready");
    const empty = JSON.parse((await execute(["status", "--profile", profile.id])).stdout);
    assert.equal(empty.profileId, profile.id); assert.deepEqual(empty.sessions, []); assert.deepEqual(empty.projects, []);
    const created = JSON.parse((await execute(["session", "create"], profile.id)).stdout);
    const own = JSON.parse((await execute(["status", "--profile", "default"], profile.id)).stdout);
    assert.deepEqual(own.sessions.map((session: { id: string }) => session.id), [first.id]);
    const beta = await fixture.sdk.profiles.open(profile.id); fixture.clients.push(beta);
    assert.equal(beta.getState().snapshot!.sessions[0]?.id, created.id);
    assert.equal(beta.getState().snapshot!.sessions[0]?.controls.modelId, null);
    const changes = join(fixture.directory, "generated-profile-changes.json"); await writeFile(changes, JSON.stringify({ name: "Generated CLI Beta renamed", color: "#776655" }));
    await execute(["profile", "update", profile.id, changes, "--revision", String(profile.revision)]);
    await assert.rejects(() => execute(["profile", "update", profile.id, changes, "--revision", String(profile.revision)]), /metadata changed/);
    const navigation = JSON.parse((await execute(["slash", `/profile use ${profile.id}`, "--session", first.id!])).stdout);
    assert.deepEqual(navigation, { kind: "profile", profileId: profile.id }); assert.equal(fixture.sdk.profileId, "default");
    const global = join(fixture.directory, "generated-global-limit.json"); await writeFile(global, JSON.stringify({ basis: "estimate", tokens: 50_000 }));
    await execute(["budget", "global", global, "--revision", "0", "--confirm-review", "--profile", profile.id]);
    assert.equal((await fixture.sdk.profiles.list()).catalog.globalBudget.limit?.tokens, 50_000);
    const controls = join(fixture.directory, "generated-global-controls.json"); await writeFile(controls, JSON.stringify({ autonomy: "Guided" }));
    await execute(["profile", "defaults", controls, "--revision", "0"]);
    const next = await beta.sessions.create(null, "Generated inherited defaults");
    assert.equal(beta.getState().snapshot!.sessions.find((session) => session.id === next.id)?.controls.autonomy, "Guided");
    await assert.rejects(() => execute(["status", "--profile", "generated-unregistered"]), /existing user profile|ready registered|does not exist/);
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await fixture.close(); }
});

test("the CLI creates and moves local tickets through the same SDK with explicit revision conflicts", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const path = join(fixture.directory, "generated-issue.json");
    await writeFile(path, JSON.stringify({ title: "Generated CLI issue", body: "Generated only", kind: "misc", phaseId: "backlog", pullRequestUrl: null }));
    const created = JSON.parse((await execute(["issues", "create", fixture.session().projectId, path])).stdout);
    assert.equal(fixture.service.controller.snapshot().issues[0]?.title, "Generated CLI issue");
    await execute(["issues", "move", created.id, "in-progress", "--revision", "0"]);
    await assert.rejects(() => execute(["issues", "move", created.id, "done", "--revision", "0"]), /Another client/);
    const board = JSON.parse((await execute(["issues", "list", fixture.session().projectId])).stdout);
    assert.equal(board.issues[0].phaseId, "in-progress");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("the CLI reviews and materializes exact repository artifacts before its explicit deletion choice", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const projectId = fixture.session().projectId, document = join(fixture.directory, "generated-repo-document.json");
    await writeFile(document, JSON.stringify({ kind: "report", name: "Generated CLI repository report", text: "Generated exact CLI revision." }));
    await execute(["artifact", "create", document, "--project", projectId]);
    const preview = JSON.parse((await execute(["project", "materialize-preview", projectId])).stdout).preview;
    await assert.rejects(() => execute(["project", "materialize-artifacts", projectId, "--digest", preview.digest]), /confirm|materializ|Use project/);
    const copy = JSON.parse((await execute(["project", "materialize-artifacts", projectId, "--digest", preview.digest, "--confirm-write"])).stdout);
    assert.equal(copy.job.status, "completed");
    assert.equal(copy.result.fileDigest, preview.fileDigest);
    const shared = await sdk.slash(fixture.sessionId, `/project-removal materialization ${copy.job.id}`, "tui");
    assert.ok(shared.kind === "text" && JSON.parse(shared.text).result.path === copy.result.path);
    await execute(["project", "remove", projectId, "--revision", "0", "--confirm-remove", "--artifacts", "materialize", "--digest", preview.setDigest, "--materialization-id", copy.job.id]);
    assert.equal(fixture.service.controller.snapshot().projects.length, 0);
    assert.ok((await readFile(join(copy.result.root, copy.result.path), "utf8")).includes("Generated exact CLI revision."));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the CLI applies explicit estimated budgets and a separate revision-bound profile policy without making a model call", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    await fixture.configure();
    const path = join(fixture.directory, "generated-budget.json"), policy = join(fixture.directory, "generated-budget-policy.json");
    await writeFile(path, JSON.stringify({ kind: "limited", basis: "estimate", tokens: 50000 }));
    const saved = await execute(["budget", "set", fixture.sessionId, path, "--confirm-review"]);
    assert.match(saved.stderr, /Budgets can interrupt/);
    assert.equal(JSON.parse(saved.stdout).status.remainingTokens, 50000);
    await writeFile(policy, JSON.stringify({ basis: "estimate", tokens: 100000 }));
    await execute(["budget", "policy", policy, "--revision", "0", "--confirm-review"]);
    const dashboard = JSON.parse((await execute(["budget", "dashboard", "--role", "solver"])).stdout);
    assert.equal(dashboard.policy.limit.tokens, 100000); assert.equal(dashboard.totals.calls, 0);
    await sdk.slash(fixture.sessionId, "/budget set 90000 - confirm-estimates", "tui");
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.remainingTokens, 90000);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/dashboard null", "tui"), /object of dashboard/);
    await writeFile(policy, "null");
    await execute(["budget", "policy", policy, "--revision", "1", "--confirm-review"]);
    assert.equal(fixture.service.controller.snapshot().budgetPolicy.limit, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the CLI holds prompts without a model and shares session/project/plan lifecycle APIs", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  const selected = ["--session", fixture.sessionId];
  try {
    const path = join(fixture.directory, "generated-prompt.txt");
    await writeFile(path, "Generated CLI held prompt.");
    const held = JSON.parse((await execute(["queue", "hold", path, ...selected])).stdout);
    assert.ok(held.id);
    const queue = JSON.parse((await execute(["queue", "list", ...selected])).stdout);
    assert.equal(queue[0].held, true);
    assert.equal((await execute(["queue", "copy", held.id, ...selected])).stdout.trim(), "Generated CLI held prompt.");
    await execute(["session", "rename", "Generated CLI session", ...selected]);
    await execute(["slash", "/read-only", ...selected]);
    assert.equal(fixture.session().mode, "read-only");
    assert.equal(fixture.session().title, "Generated CLI session");
    const side = JSON.parse((await execute(["session", "spawn", "side", ...selected])).stdout);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.kind, "side");
    const projectId = fixture.session().projectId;
    const configuration = JSON.parse((await execute(["project", "get", projectId])).stdout).configuration;
    const settingsFile = join(fixture.directory, "generated-settings.json");
    await writeFile(settingsFile, JSON.stringify({ ...configuration.values, port: 4501 }));
    await execute(["project", "set", projectId, settingsFile, "--revision", String(configuration.revision)]);
    assert.equal(fixture.service.controller.snapshot().projectConfigurations[0]?.values.port, 4501);
    await execute(["slash", "/agent", ...selected]);
    const plan = JSON.parse((await execute(["plan", "save", path, "--digest", "absent", ...selected])).stdout);
    assert.ok(plan.id);
    const revision = String(fixture.session().revision);
    await assert.rejects(() => execute(["session", "delete", ...selected, "--revision", revision, "--confirm-remove"]), /--children/);
    await execute(["session", "delete", ...selected, "--revision", revision, "--confirm-remove", "--children", "detach"]);
    assert.equal(fixture.service.controller.snapshot().sessions.some((session) => session.id === fixture.sessionId), false);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.parentSessionId, undefined);
    assert.equal(fixture.service.controller.snapshot().artifacts[0]?.id, plan.id);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("the CLI creates project-free metachat, previews scope and requires reviewed configuration digests", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const created = JSON.parse((await execute(["session", "create"])).stdout);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.projectId, null);
    const preview = JSON.parse((await execute(["suggestions", "preview", "--session", created.id])).stdout);
    assert.equal(preview.preview.scope, "project-free"); assert.equal(preview.preview.sources.length, 0);
    const meta = JSON.parse((await execute(["metachat", "Generated settings request", "--session", created.id])).stdout);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === meta.id)?.kind, "metachat");
    const path = join(fixture.directory, "generated-config-proposal.json");
    await writeFile(path, JSON.stringify({ target: "global", section: "instructions", value: "Generated CLI guidance.", reason: "Generated exact review." }));
    const proposal = JSON.parse((await execute(["configuration", "propose", path, "--session", meta.id])).stdout);
    const review = JSON.parse((await execute(["configuration", "review", proposal.id])).stdout);
    await assert.rejects(() => execute(["configuration", "apply", proposal.id, "--digest", review.proposal.contentDigest]), /Acknowledge/);
    await execute(["configuration", "apply", proposal.id, "--digest", review.proposal.contentDigest, "--acknowledge-config-risk"]);
    assert.equal(fixture.service.controller.snapshot().settings.values.instructions, "Generated CLI guidance.");
    assert.deepEqual(JSON.parse((await execute(["attention", "list"])).stdout), []);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("the CLI previews exact folders and attaches typed local context without inference", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const selected = ["--session", fixture.sessionId];
    const file = join(fixture.directory, "generated-context.txt"); await writeFile(file, "Generated CLI attachment.");
    const attached = JSON.parse((await execute(["context", "file", file, ...selected])).stdout);
    assert.equal(fixture.session().draft.attachments[0]?.kind, "local_file");
    assert.equal((await execute(["context", "read", attached.id, ...selected])).stdout.trim(), "Generated CLI attachment.");
    const preview = JSON.parse((await execute(["context", "folder", fixture.project, ...selected])).stdout).preview;
    await execute(["context", "folder", fixture.project, ...selected, "--digest", preview.digest, "--confirm-review"]);
    assert.equal(fixture.session().draft.attachments[1]?.kind, "folder");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("the CLI exposes unconfigured SSH readiness without pretending a host, model or local fallback", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const status = JSON.parse((await execute(["remote", "status"])).stdout).remote;
    assert.equal(status.ready, false); assert.equal(status.hostFingerprint, null);
    await assert.rejects(() => execute(["remote", "probe"]), /Configure an SSH target explicitly/);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("the CLI creates an owned worktree and fresh bound chat without switching the base or starting inference", async () => {
  const fixture = await setupFixture(), git = initializeGeneratedRepository(fixture.project);
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const workspace = JSON.parse((await execute(["workspace", "create", fixture.session().projectId, "moguri/generated-cli", "main"])).stdout);
    assert.equal(workspace.status, "ready");
    const created = JSON.parse((await execute(["workspace", "session", workspace.id])).stdout);
    const file = JSON.parse((await execute(["workspace", "file", "fixture.txt", "--session", created.id])).stdout);
    assert.equal(file.text, "generated original\n");
    assert.equal(fixture.service.controller.snapshot().sessions.find((value) => value.id === created.id)?.workspaceId, workspace.id);
    assert.equal(git(["branch", "--show-current"]), "main");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("the CLI retains typed documents, exports exact revisions and requires reviewed artifact choices for project removal", async () => {
  const fixture = await setupFixture(), projectId = fixture.session().projectId;
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const document = join(fixture.directory, "generated-artifact.json"), changes = join(fixture.directory, "generated-artifact-changes.json"), destination = join(fixture.directory, "generated-artifact-export.json");
    await writeFile(document, JSON.stringify({ kind: "report", name: "Generated CLI retained report", text: "Generated first report." }));
    const created = JSON.parse((await execute(["artifact", "create", document, "--project", projectId])).stdout);
    await writeFile(changes, JSON.stringify({ text: "Generated revised report." }));
    await execute(["artifact", "update", created.id, changes, "--revision", "0"]);
    await assert.rejects(() => execute(["artifact", "update", created.id, changes, "--revision", "0"]), /changed|Reload/);
    const saved = JSON.parse((await execute(["artifact", "export", created.id, "--output", destination])).stdout);
    assert.ok(saved.digest); assert.equal(JSON.parse(await readFile(destination, "utf8")).documents[0].revisions.length, 2);
    const preview = JSON.parse((await execute(["project", "removal-preview", projectId])).stdout).preview;
    await assert.rejects(() => execute(["project", "remove", projectId, "--revision", "0", "--confirm-remove"]), /explicitly choose/);
    await execute(["project", "remove", projectId, "--revision", "0", "--confirm-remove", "--artifacts", "retain", "--digest", preview.digest]);
    const retained = JSON.parse((await execute(["artifact", "read", created.id])).stdout);
    assert.equal(retained.artifact.projectId, null); assert.equal(retained.text, "Generated revised report.");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("the CLI answers only the exact canonical pending question with actual user provenance", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    await fixture.configure(); await fixture.send("generated structured question");
    const deadline = Date.now() + 8000;
    while (!fixture.service.controller.snapshot().questions.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 15));
    const question = JSON.parse((await execute(["question", "list", "--session", fixture.sessionId])).stdout)[0];
    assert.ok(question); assert.equal(question.answer, null);
    const path = join(fixture.directory, "generated-question-answer.txt");
    await writeFile(path, "Generated actual CLI answer.");
    await execute(["question", "answer", question.id, path, "--revision", "0"]); await fixture.terminal();
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer?.actor, "user");
    assert.match((await execute(["artifact", "read", fixture.service.controller.snapshot().artifacts[0]!.id])).stdout, /Generated actual CLI answer/);
    assert.deepEqual(fixture.service.controller.snapshot().settings.values.permissions.tools, []);
  } finally { await fixture.close(); }
});
