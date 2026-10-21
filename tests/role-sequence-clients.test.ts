import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { roleSequenceFixture } from "./fixtures/role-sequence-api.ts";

test("compiled CLI reads exact independent role data after source deletion without a root or model operation", async () => {
  const f = await roleSequenceFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    const value = JSON.parse((await execute(["roles", f.initial.id, "1"])).stdout);
    assert.equal(value.type, "role.sequence.read"); assert.equal(value.sequence.status, "completed"); assert.match(value.step.result, /RETAINED_CRITIC_RESULT_NOT_CONTEXT/);
    await assert.rejects(() => execute(["roles", f.initial.id, "32"])); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("shared role commands inspect metadata/raw steps without dispatch, acceptance or a source-session permission grant", async () => {
  const f = await roleSequenceFixture();
  try {
    f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
    await f.sdk.refresh();
    const list = await f.sdk.slash(f.sessionId, "/roles", "cli"); assert.ok(list.kind === "text"); assert.equal(JSON.parse(list.text)[0].id, f.initial.id);
    await assert.rejects(() => f.sdk.slash(f.sessionId, `/roles ${f.initial.id} invalid`, "tui"), { code: "role_sequence_command" });
    await assert.rejects(() => f.sdk.slash(f.sessionId, `/roles ${f.initial.id} 2`, "tui"), { code: "role_sequence_step" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
