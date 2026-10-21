import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";

test("shared candidate commands preview/stage and separately apply exact reviewed bytes without calling a model", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture();
  try {
    const input = { stageWorkspaceId: f.workspace.id, patch: f.patch };
    const preview = await f.sdk.slash(f.sessionId, `/candidate preview ${JSON.stringify(input)}`, "tui");
    assert.ok(preview.kind === "text"); const review = JSON.parse(preview.text).preview;
    await assert.rejects(() => f.sdk.slash(f.sessionId, `/candidate stage ${JSON.stringify({ ...input, expectedDigest: review.digest })}`, "tui"), /confirm-stage/);
    const staged = await f.sdk.slash(f.sessionId, `/candidate stage ${JSON.stringify({ ...input, expectedDigest: review.digest })} confirm-stage`, "tui");
    assert.ok(staged.kind === "text"); const candidate = JSON.parse(staged.text).candidate;
    assert.equal(candidate.status, "staged"); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const pending = await f.sdk.slash(f.sessionId, `/candidate apply-preview ${candidate.id}`, "tui"); assert.ok(pending.kind === "text");
    const exact = JSON.parse(pending.text).preview;
    const applied = await f.sdk.slash(f.sessionId, `/candidate apply ${candidate.id} ${candidate.revision} ${exact.digest} confirm-apply`, "tui"); assert.ok(applied.kind === "text");
    assert.equal(JSON.parse(applied.text).candidate.status, "applied");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.deepEqual(await f.sdk.slash(f.sessionId, "/candidates", "desktop"), { kind: "panel", panel: "Candidates" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("the compiled CLI binds exact candidate review, reports real outcomes and refuses unconfirmed writes", { timeout: 30_000 }, async () => {
  const f = await candidateApiFixture(), execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args], {
    env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") },
  });
  try {
    const path = join(f.directory, "generated-candidate.json"); await writeFile(path, JSON.stringify(f.patch));
    const flags = ["--session", f.sessionId, "--workspace", f.workspace.id], preview = JSON.parse((await execute(["candidate", "preview", path, ...flags])).stdout).preview;
    await assert.rejects(() => execute(["candidate", "stage", path, ...flags, "--digest", preview.digest]), /confirm-write/);
    const staged = JSON.parse((await execute(["candidate", "stage", path, ...flags, "--digest", preview.digest, "--confirm-write"])).stdout);
    assert.equal(staged.candidate.status, "staged");
    const review = JSON.parse((await execute(["candidate", "apply-preview", staged.candidate.id, "--session", f.sessionId])).stdout).preview;
    const applied = JSON.parse((await execute(["candidate", "apply", staged.candidate.id, "--session", f.sessionId, "--revision", String(staged.candidate.revision), "--digest", review.digest, "--confirm-write"])).stdout);
    assert.equal(applied.candidate.status, "applied");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
