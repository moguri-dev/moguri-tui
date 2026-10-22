import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { setupDecisions } from "./fixtures/decisions-api.ts";

test("actual CLI and shared slash configure only explicit decision policy and inspect the same provider/actor/charges without a second model call", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setupDecisions();
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "decisions", ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    assert.equal(JSON.parse((await cli(["status", "--session", f.sessionId])).stdout).ready, true);
    const status = await f.sdk.slash(f.sessionId, "/decisions status", "tui"); assert.equal(status.kind, "text");
    const policy = { ...f.sdk.settings.get()!.values.decisions, minimumConfidence: 0.97 }, file = join(f.directory, "generated-decisions-policy.json");
    await writeFile(file, JSON.stringify(policy));
    await assert.rejects(() => cli(["set", file]), /confirm-review/);
    await cli(["set", file, "--confirm-review"]); await f.sdk.refresh();
    assert.equal(f.sdk.settings.get()!.values.decisions.minimumConfidence, 0.97);
    assert.equal(f.requests.length, 0); assert.equal(f.advice.requests.length, 0);
    await f.sdk.slash(f.sessionId, "/decisions set " + JSON.stringify({ ...policy, minimumConfidence: 0.98 }), "tui");
    assert.equal(f.sdk.settings.get()!.values.decisions.minimumConfidence, 0.98);
    await f.send("generated tool exact shared decision clients"); await f.terminal(); await f.sdk.refresh();
    const record = f.sdk.decisions.list(f.sessionId)[0]; assert.ok(record);
    const read = JSON.parse((await cli(["read", record.id])).stdout);
    assert.equal(read.decision.status, "applied"); assert.equal(read.decision.applied.actor, "decision-provider");
    const slash = await f.sdk.slash(f.sessionId, `/decisions read ${record.id}`, "tui"); assert.ok(slash.kind === "text");
    assert.deepEqual(JSON.parse(slash.text).decision, read.decision);
    assert.equal(JSON.parse((await cli(["list", "--session", f.sessionId])).stdout).length, 1);
    await cli(["stop", record.id]);
    assert.equal(f.requests.length, 2); assert.equal(f.advice.requests.length, 1);
    assert.equal(f.session().controls.modelId, f.modelId);
  } finally { await f.close(); }
});
