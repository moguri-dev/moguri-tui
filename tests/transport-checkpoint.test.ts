import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { remoteWinddownApiFixture } from "./fixtures/winddown-api.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { MoguriError, parse, unsettledWinddownCommit, WinddownCommandSchema, WinddownQuerySchema } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("typed checkpoint source paths use the full file-path bounds, not artifact-ID bounds", () => {
  const paths = ["generated/".repeat(14) + "fixture.txt", "a".repeat(4096)];
  const preview = parse(WinddownQuerySchema, { type: "winddown.source.preview", winddownId: "generated-report", paths });
  assert.ok(preview.type === "winddown.source.preview"); assert.deepEqual(preview.paths, paths);
  const accepted = parse(WinddownCommandSchema, { type: "winddown.source.accept", winddownId: "generated-report", paths,
    expectedRevision: 0, expectedDigest: "a".repeat(64), confirm: true });
  assert.ok(accepted.type === "winddown.source.accept"); assert.deepEqual(accepted.paths, paths);
  assert.throws(() => parse(WinddownQuerySchema, { type: "winddown.source.preview", winddownId: "generated-report", paths: ["a".repeat(4097)] }), /protocol schema/);
  assert.throws(() => parse(WinddownCommandSchema, { type: "winddown.source.accept", winddownId: "generated-report", paths: ["a".repeat(4097)],
    expectedRevision: 0, expectedDigest: "a".repeat(64), confirm: true }), /protocol schema/);
});

test("actual SSH checkpoint separately accepts source then publishes only at its pinned peer, preserving source index/HEAD and all-role charges", { skip: process.platform !== "darwin", timeout: 40000 }, async () => {
  const f = await remoteWinddownApiFixture();
  try {
    assert.ok(f.workspace);
    const git = initializeGeneratedRepository(f.workspace);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    const report = await f.run(); assert.equal(report.winddown.status, "ready");
    await f.sdk.workspaces.file(f.sessionId, "fixture.txt");
    await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    const id = report.winddown.id, input = { winddownId: id, sessionId: f.sessionId, candidateIds: [], remoteAccepted: true as const,
      branch: "moguri/generated-peer-checkpoint", message: "Retain exact separately accepted peer work" };
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /accept|source/i);
    await writeFile(join(f.workspace, "fixture.txt"), "Generated actual-user accepted peer bytes.\n");
    const deepPath = "generated/".repeat(14) + "fixture.txt";
    await mkdir(join(f.workspace, dirname(deepPath)), { recursive: true }); await writeFile(join(f.workspace, deepPath), "Generated exact deeply nested peer source.\n");
    await writeFile(join(f.workspace, "generated-unrelated.txt"), "Generated unrelated staged bytes.\n");
    git(["add", "--", "generated-unrelated.txt"]);
    const head = git(["rev-parse", "HEAD"]), index = await readFile(join(f.workspace, ".git/index"));
    const source = await f.sdk.winddown.sourcePreview(id, ["fixture.txt", deepPath]);
    assert.equal(source.preview.document.source.env, "Remote");
    await f.sdk.winddown.acceptSource(id, ["fixture.txt", deepPath], source.preview.revision, source.preview.digest, true);
    const preview = await f.sdk.winddown.commitPreview(input);
    assert.equal(preview.preview.document.version, 3); assert.equal(preview.preview.document.source.env, "Remote");
    await f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true);
    const result = await f.sdk.winddown.waitCommit(id);
    assert.equal(result.winddown.status, "completed", result.winddown.diagnostic ?? "");
    assert.ok(result.winddown.commit?.publishedCommit); assert.equal(result.winddown.commit.actor, "user");
    assert.equal(git(["rev-parse", `refs/heads/${input.branch}`]), result.winddown.commit.publishedCommit);
    assert.equal(git(["show", `${input.branch}:fixture.txt`]), "Generated actual-user accepted peer bytes.");
    assert.equal(git(["show", `${input.branch}:${deepPath}`]), "Generated exact deeply nested peer source.");
    assert.equal(git(["diff-tree", "--no-commit-id", "--name-only", "-r", input.branch]), ["fixture.txt", deepPath].sort().join("\n"));
    assert.equal(git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.workspace, ".git/index")), index);
    const inspection = await f.sdk.winddown.inspectCommit(id);
    assert.equal(inspection.inspection.result?.commit, result.winddown.commit.publishedCommit);
    assert.equal(f.requests.length, 0); assert.equal(f.solver.requests.length, 2);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 2);
  } finally { await f.close(); }
});

test("failed original SSH checkpoint key preparation cannot claim RPC dispatch, quarantine an unstarted source writer or retry Git", { skip: process.platform !== "darwin", timeout: 35000 }, async () => {
  const secrets = new Map<string, string>(); let fail = false;
  const vault = { read: async (id: string) => secrets.get(id) ?? null, remove: async (id: string) => { secrets.delete(id); },
    write: async (id: string, value: string) => { if (fail) throw new MoguriError("generated_key_write", "Generated original checkpoint key preparation failed.", 409); secrets.set(id, value); } };
  const f = await remoteWinddownApiFixture({ vault });
  try {
    assert.ok(f.workspace); const git = initializeGeneratedRepository(f.workspace), report = await f.run(), id = report.winddown.id;
    await f.sdk.workspaces.file(f.sessionId, "fixture.txt"); await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    const source = await f.sdk.winddown.sourcePreview(id, ["fixture.txt"]);
    await f.sdk.winddown.acceptSource(id, ["fixture.txt"], source.preview.revision, source.preview.digest, true);
    const input = { winddownId: id, sessionId: f.sessionId, candidateIds: [], remoteAccepted: true as const,
      branch: "moguri/generated-no-key-no-peer-git", message: "Never dispatch Git without its exact retained private key" };
    const preview = await f.sdk.winddown.commitPreview(input); fail = true;
    await f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true);
    const result = await f.sdk.winddown.waitCommit(id);
    assert.equal(result.winddown.status, "failed"); assert.equal(result.winddown.commit?.publicationAttempted, false);
    assert.equal(git(["for-each-ref", "--format=%(refname)", `refs/heads/${input.branch}`]), "");
    assert.equal(secrets.has(result.winddown.commit!.jobId), false); assert.deepEqual(f.service.controller.ownedWriteRoots(), []);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 2); assert.equal(f.requests.length, 0); assert.equal(f.solver.requests.length, 2);
  } finally { fail = false; await f.close(); }
});

test("lost actual SSH publication response retains its exact writer/report until fresh user inspection, without replay or successful-job relabeling", { skip: process.platform !== "darwin", timeout: 50000 }, async () => {
  const f = await remoteWinddownApiFixture(), original = f.service.controller.remote.checkpoint.bind(f.service.controller.remote);
  try {
    assert.ok(f.workspace); const git = initializeGeneratedRepository(f.workspace);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    const report = await f.run(), id = report.winddown.id;
    await f.sdk.workspaces.file(f.sessionId, "fixture.txt"); await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    await writeFile(join(f.workspace, "fixture.txt"), "Generated peer bytes with a lost final response.\n");
    const source = await f.sdk.winddown.sourcePreview(id, ["fixture.txt"]);
    await f.sdk.winddown.acceptSource(id, ["fixture.txt"], source.preview.revision, source.preview.digest, true);
    const input = { winddownId: id, sessionId: f.sessionId, candidateIds: [], remoteAccepted: true as const,
      branch: "moguri/generated-lost-peer-checkpoint", message: "Retain exact peer publication despite lost response" };
    const preview = await f.sdk.winddown.commitPreview(input), charges = JSON.stringify(f.service.controller.snapshot().budgetEntries);
    let attempts = 0;
    f.service.controller.remote.checkpoint = async (...args) => { attempts++; await original(...args); throw new MoguriError("generated_lost_response", "Generated actual peer final response was lost.", 409); };
    await f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true);
    const partial = await f.sdk.winddown.waitCommit(id), commit = partial.winddown.commit!;
    assert.equal(partial.winddown.status, "partial"); assert.equal(unsettledWinddownCommit(partial.winddown), true);
    assert.equal(commit.publicationAttempted, true); assert.equal(commit.publishedCommit, null);
    const published = git(["rev-parse", `refs/heads/${input.branch}`]), roots = f.service.controller.ownedWriteRoots();
    assert.ok(roots.some((root) => root.startsWith("remote/")));
    const artifact = f.service.controller.snapshot().artifacts.find((artifact) => artifact.id === id)!;
    await assert.rejects(() => f.sdk.command({ type: "artifact.delete", artifactId: id, expectedRevision: artifact.revision, confirm: true }), /settle|checkpoint|owner/i);
    await assert.rejects(() => f.sdk.command({ type: "artifact.update", artifactId: id, expectedRevision: artifact.revision, changes: { status: "archived" } }), /settle|checkpoint|owner/i);
    await assert.rejects(() => f.sdk.command({ type: "session.archive", sessionId: f.sessionId }), /inspect|checkpoint/i);
    await assert.rejects(() => f.sdk.command({ type: "session.delete", sessionId: f.sessionId, expectedRevision: f.session().revision, confirm: true }), /inspect|checkpoint/i);
    const inspected = await f.sdk.winddown.inspectCommit(id);
    assert.equal(inspected.inspection.review.document.actualCommit, published);
    assert.equal(inspected.inspection.result?.commit, published);
    assert.deepEqual(f.service.controller.ownedWriteRoots(), roots);
    await assert.rejects(() => f.sdk.winddown.reconcileCommit(id, inspected.inspection.review.revision, "0".repeat(64), true), /changed|quarantined/i);
    git(["update-ref", `refs/heads/${input.branch}`, preview.preview.document.base, published]);
    await assert.rejects(() => f.sdk.winddown.inspectCommit(id), /ref|base/i);
    assert.equal(unsettledWinddownCommit((await f.sdk.winddown.read(id)).winddown), true);
    git(["update-ref", `refs/heads/${input.branch}`, published, preview.preview.document.base]);
    const cli = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "winddown", ...args],
      { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
    const fresh = JSON.parse((await cli(["inspect", id])).stdout);
    await assert.rejects(() => cli(["reconcile", id, "--revision", String(fresh.inspection.review.revision), "--digest", fresh.inspection.review.digest]), /confirm-review|Use winddown/i);
    await cli(["reconcile", id, "--revision", String(fresh.inspection.review.revision), "--digest", fresh.inspection.review.digest, "--confirm-review"]);
    const settled = await f.sdk.winddown.read(id);
    assert.equal(settled.winddown.status, "partial"); assert.equal(settled.winddown.diagnostic, partial.winddown.diagnostic);
    assert.equal(settled.winddown.commit?.inspection?.actor, "user"); assert.equal(unsettledWinddownCommit(settled.winddown), false);
    assert.deepEqual(f.service.controller.ownedWriteRoots(), []);
    assert.equal(f.service.controller.snapshot().jobs.find((job) => job.id === commit.jobId)?.status, "partial");
    assert.equal(JSON.stringify(f.service.controller.snapshot().budgetEntries), charges); assert.equal(attempts, 1);
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /accept|source|review|state/i);
    const reopened = new EventStore(f.service.store.path, f.retentionKey);
    try { assert.equal(JSON.parse(reopened.blob(settled.winddown.commit!.inspection!.inputDigest)).actualCommit, published); }
    finally { reopened.close(); }
    assert.equal(f.requests.length, 0); assert.equal(f.solver.requests.length, 2);
  } finally { f.service.controller.remote.checkpoint = original; await f.close(); }
});

test("changed separately accepted SSH source never admits a new Git job or replaces the actual user acceptance", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const f = await remoteWinddownApiFixture();
  try {
    assert.ok(f.workspace); const git = initializeGeneratedRepository(f.workspace), report = await f.run(), id = report.winddown.id;
    await f.sdk.workspaces.file(f.sessionId, "fixture.txt");
    await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    const source = await f.sdk.winddown.sourcePreview(id, ["fixture.txt"]);
    await f.sdk.winddown.acceptSource(id, ["fixture.txt"], source.preview.revision, source.preview.digest, true);
    await writeFile(join(f.workspace, "fixture.txt"), "Generated changed after original source acceptance.\n");
    await assert.rejects(() => f.sdk.winddown.commitPreview({ winddownId: id, sessionId: f.sessionId, candidateIds: [], remoteAccepted: true,
      branch: "moguri/generated-never-stale", message: "Do not replace accepted peer bytes" }), /accepted.*changed|source.*changed/i);
    assert.equal(git(["for-each-ref", "--format=%(refname)", "refs/heads/moguri/generated-never-stale"]), "");
    assert.equal((await f.sdk.winddown.read(id)).winddown.commit, null);
    assert.equal(f.solver.requests.length, 2);
  } finally { await f.close(); }
});
