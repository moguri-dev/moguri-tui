import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { roleProposalFixture } from "./fixtures/role-proposal-api.ts";

test("compiled CLI reads actual retained role provenance, binds it into review and separately stages/applies without another model", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleProposalFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "candidate", ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    const input = join(f.directory, "generated-role-patch.json"); await writeFile(input, JSON.stringify(f.patch));
    const proposal = JSON.parse((await execute(["role-proposal", f.sequence.id])).stdout);
    assert.equal(proposal.document.roleOrigin.stepId, f.sequence.steps[2]!.stepId);
    const flags = ["--session", f.sessionId, "--workspace", f.workspace.id, "--role-sequence", f.sequence.id];
    const preview = JSON.parse((await execute(["preview", input, ...flags])).stdout).preview;
    assert.equal(preview.document.roleOrigin.sequenceId, f.sequence.id);
    await assert.rejects(() => execute(["stage", input, ...flags, "--digest", preview.digest]));
    await assert.rejects(() => execute(["stage", input, ...flags, "--digest", preview.digest, "--confirm-write", "--generation", "generated-conflicting-origin"]));
    const staged = JSON.parse((await execute(["stage", input, ...flags, "--digest", preview.digest, "--confirm-write"])).stdout);
    assert.equal(staged.candidate.status, "staged"); assert.equal(staged.candidate.roleOrigin.sequenceId, f.sequence.id);
    assert.equal(staged.candidate.acceptance, null); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const application = JSON.parse((await execute(["apply-preview", staged.candidate.id, "--session", f.sessionId])).stdout).preview;
    const applied = JSON.parse((await execute(["apply", staged.candidate.id, "--session", f.sessionId, "--revision", String(staged.candidate.revision), "--digest", application.digest, "--confirm-write"])).stdout);
    assert.equal(applied.candidate.status, "applied"); assert.equal(applied.candidate.acceptance.actor, "user");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("shared native role-proposal commands preserve review-bound origin and reject mixed or edited assertions", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleProposalFixture();
  try {
    const inspected = await f.sdk.slash(f.sessionId, `/candidate role-proposal ${f.sequence.id}`, "tui");
    assert.ok(inspected.kind === "text"); assert.equal(JSON.parse(inspected.text).document.roleOrigin.sequenceId, f.sequence.id);
    const input = { stageWorkspaceId: f.workspace.id, patch: f.patch, roleSequenceId: f.sequence.id };
    const read = await f.sdk.slash(f.sessionId, `/candidate preview ${JSON.stringify(input)}`, "tui");
    assert.ok(read.kind === "text"); const preview = JSON.parse(read.text).preview;
    await assert.rejects(() => f.sdk.slash(f.sessionId, `/candidate stage ${JSON.stringify({ ...input, generationId: "generated-conflicting", expectedDigest: preview.digest })} confirm-stage`, "tui"), { code: "role_proposal_source" });
    const staged = await f.sdk.slash(f.sessionId, `/candidate stage ${JSON.stringify({ ...input, expectedDigest: preview.digest })} confirm-stage`, "tui");
    assert.ok(staged.kind === "text"); assert.equal(JSON.parse(staged.text).candidate.roleOrigin.sequenceId, f.sequence.id);
    assert.equal(JSON.parse(staged.text).candidate.acceptance, null); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});
