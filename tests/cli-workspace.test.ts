import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

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
    await execute(["session", "delete", ...selected, "--revision", String(fixture.session().revision), "--confirm-remove"]);
    assert.equal(fixture.service.controller.snapshot().sessions.some((session) => session.id === fixture.sessionId), false);
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
