import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("shared slash and CLI compound commands preserve exact source/cost review and require a separate actual-user stage/test decision", { skip: process.platform !== "darwin", timeout: ciTime(25000) }, async () => {
  const f = await compoundApiFixture(), sdk = f.sdk;
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "compound", ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    await f.configure();
    const selection = Object.fromEntries(Object.entries(f.input).filter(([key]) => key !== "sessionId")), file = join(f.directory, "generated-compound-input.json");
    await writeFile(file, JSON.stringify(selection));
    const preview = await sdk.slash(f.sessionId, `/compound preview ${JSON.stringify(selection)}`, "tui");
    assert.equal(preview.kind, "text"); if (preview.kind !== "text") throw new Error("Generated shared compound preview was not returned.");
    const reviewed: { confirmCommand: string; preview: { digest: string } } = JSON.parse(preview.text);
    assert.equal(JSON.parse((await cli(["preview", file, "--session", f.sessionId])).stdout).preview.digest, reviewed.preview.digest);
    await assert.rejects(() => cli(["start", file, "--session", f.sessionId, "--digest", reviewed.preview.digest]), /confirm-cost/);
    const started = await sdk.slash(f.sessionId, reviewed.confirmCommand, "tui");
    assert.ok(started.kind === "text");
    const id: string = JSON.parse(started.text).id;
    const pending = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
      return value?.status === "waiting_validation" ? value : null;
    });
    const read = JSON.parse((await cli(["read", id])).stdout);
    assert.equal(read.pendingValidation.document.proposal.plan, f.proposal.plan);
    const exact = await sdk.slash(f.sessionId, `/compound validation ${id}`, "tui");
    assert.ok(exact.kind === "text");
    assert.equal(JSON.parse(exact.text).review.document.command, f.command);
    assert.match(JSON.parse(exact.text).confirmCommand, /confirm-stage-and-test/);
    await assert.rejects(() => cli(["review", id, read.pendingValidation.validationId, "--digest", read.pendingValidation.digest, "--revision", String(pending.revision)]), /confirm-stage-and-test/);
    assert.equal(await f.source(), "generated original\n");
    const denied = await sdk.slash(f.sessionId, `/compound deny ${id} ${read.pendingValidation.validationId} ${pending.revision} ${read.pendingValidation.digest} confirm-deny`, "tui");
    assert.equal(denied.kind, "ok");
    await waitFor(() => !f.session().turnId);
    assert.equal(f.providers[2]!.requests.length, 0); assert.equal(f.service.controller.snapshot().candidates.length, 0);
    await assert.rejects(() => sdk.slash(f.sessionId, `/compound preview ${JSON.stringify({ ...selection, sessionId: "generated-forged-owner" })}`, "tui"), /session|scope|root|override/i);
  } finally { await f.close(); }
});
