import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { modelEvidenceFixture } from "./fixtures/model-evidence-api.ts";

test("compiled CLI reads explicit provider claims through the SDK without changing model selection or calling inference", async () => {
  const f = await modelEvidenceFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "models", ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    await execute(["list"]); assert.equal(f.reads(), 0);
    const controls = structuredClone(f.session().controls), result = JSON.parse((await execute(["evidence", f.modelId])).stdout);
    assert.equal(result.type, "model.evidence"); assert.equal(result.evidence.status, "declared");
    assert.equal(result.evidence.claimed.family, "generated-provider-declared-family");
    assert.match(result.evidence.warning, /not.*independen/i); assert.equal(f.reads(), 1);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.session().controls, controls);
    await assert.rejects(() => execute(["evidence", "generated-foreign-id"])); assert.equal(f.reads(), 1);
  } finally { await f.close(); }
});
