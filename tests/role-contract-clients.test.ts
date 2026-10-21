import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { roleContractFixture } from "./fixtures/role-contract-api.ts";

test("compiled CLI and shared role-contract readers inspect exact original advice without another model or acceptance", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleContractFixture();
  try {
    const created = await f.run(); await f.settled(created.id);
    const cli = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "roles", "contract", created.id, ...args],
      { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
    const read = JSON.parse((await cli(["2"])).stdout);
    assert.equal(read.type, "role.contract.read"); assert.equal(read.result.status, "valid");
    assert.equal(read.result.value.verdict, "revise"); assert.deepEqual(read.contextRoleIndices, [1]);
    const shared = await f.sdk.slash(f.sessionId, `/roles contract ${created.id} 2`, "tui");
    assert.equal(shared.kind, "text"); if (shared.kind === "text") assert.deepEqual(JSON.parse(shared.text), read);
    await assert.rejects(() => cli(["32"])); assert.equal(f.requests.length, 4); assert.equal(f.preparations(), 4);
    assert.equal(f.control.snapshot().candidates.length, 0);
  } finally { await f.close(); }
});
