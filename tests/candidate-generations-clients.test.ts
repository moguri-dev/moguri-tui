import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { candidateGenerationFixture, generatedCandidatePatch } from "./fixtures/candidate-generation-api.ts";
import { waitFor } from "./fixture.ts";

test("shared generation commands require explicit cost review and preserve canonical model output for separate staging", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await candidateGenerationFixture();
  try {
    const value = { stageWorkspaceId: f.workspace.id, input: f.input };
    const reviewed = await f.sdk.slash(f.sessionId, `/candidate generate-preview ${JSON.stringify(value)}`, "tui"); assert.ok(reviewed.kind === "text");
    const expectedDigest = JSON.parse(reviewed.text).preview.digest, input = JSON.stringify({ ...value, expectedDigest });
    await assert.rejects(() => f.sdk.slash(f.sessionId, `/candidate generate ${input}`, "tui"), /confirm-cost/); assert.equal(f.requests.length, 0);
    const generated = await f.sdk.slash(f.sessionId, `/candidate generate ${input} confirm-cost`, "tui"); assert.ok(generated.kind === "text");
    const result = JSON.parse(generated.text); assert.equal(result.generation.status, "proposed"); assert.equal(f.requests.length, 1);
    const patch = result.proposal.patch, preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch)).preview;
    const staged = await f.sdk.slash(f.sessionId, `/candidate stage ${JSON.stringify({ stageWorkspaceId: f.workspace.id, patch, expectedDigest: preview.digest, generationId: result.generation.id })} confirm-stage`, "tui");
    assert.ok(staged.kind === "text"); assert.equal(JSON.parse(staged.text).candidate.generationId, result.generation.id);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("compiled generation CLI performs one reviewed model request, reports actual provenance and waits for a separately confirmed stage", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await candidateGenerationFixture(), execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args], {
    env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") },
  });
  try {
    const path = join(f.directory, "generated-selection.json"); await writeFile(path, JSON.stringify(f.input));
    const flags = ["--session", f.sessionId, "--workspace", f.workspace.id];
    const preview = JSON.parse((await execute(["candidate", "generate-preview", path, ...flags])).stdout).preview;
    await assert.rejects(() => execute(["candidate", "generate", path, ...flags, "--digest", preview.digest]), /confirm-cost/); assert.equal(f.requests.length, 0);
    const generated = JSON.parse((await execute(["candidate", "generate", path, ...flags, "--digest", preview.digest, "--confirm-cost"])).stdout);
    assert.equal(generated.generation.status, "proposed"); assert.equal(f.requests.length, 1);
    const document = join(f.directory, "generated-patch.json"); await writeFile(document, JSON.stringify(generated.proposal.patch));
    const stage = JSON.parse((await execute(["candidate", "preview", document, ...flags])).stdout).preview;
    const staged = JSON.parse((await execute(["candidate", "stage", document, ...flags, "--digest", stage.digest, "--generation", generated.generation.id, "--confirm-write"])).stdout);
    assert.equal(staged.candidate.generationId, generated.generation.id);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), generatedCandidatePatch.edits[0]!.text);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("compiled generation CLI SIGINT stops only its exact owned request and exits unsuccessfully with retained unknown usage", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await candidateGenerationFixture();
  try {
    const input = { ...f.input, task: "generated slow CLI interrupt" }, path = join(f.directory, "generated-interrupt-selection.json"); await writeFile(path, JSON.stringify(input));
    const preview = (await f.sdk.candidates.generatePreview(f.sessionId, f.workspace.id, input)).preview;
    const execution = promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "candidate", "generate", path, "--session", f.sessionId, "--workspace", f.workspace.id, "--digest", preview.digest, "--confirm-cost"],
      { timeout: 10_000, env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
    const failed = assert.rejects(execution, (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error && "stdout" in error && typeof error.stdout === "string");
      assert.equal(error.code, 1); const result = JSON.parse(error.stdout);
      assert.ok(["stopped", "partial"].includes(result.generation.status)); assert.equal(result.generation.stopRequested, true);
      return true;
    });
    await waitFor(() => f.requests.length === 1); execution.child.kill("SIGINT"); await failed;
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0); assert.equal(f.requests.length, 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});
