import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";

test("shared SDK/TUI planned-reservation inspection preserves scope and never creates a reported model call", async () => {
  const f = await budgetPlanFixture();
  try {
    const plan = f.create(), page = await f.sdk.budgets.plans({ sessionId: f.sessionId, status: "held" });
    assert.equal(page.plans[0]?.id, plan.id);
    const result = await f.sdk.slash(f.sessionId, `/dashboard plans ${JSON.stringify({ sessionId: f.sessionId, status: "held" })}`, "tui");
    assert.ok(result.kind === "text"); assert.equal(JSON.parse(result.text).plans[0].id, plan.id);
    await assert.rejects(() => f.sdk.slash(f.sessionId, '/dashboard plans {"repositoryId":42}', "tui"), /valid|invalid|schema/i);
    assert.equal((await f.sdk.budgets.calls()).calls.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("compiled CLI planned-reservation queries expose captured holds without source files, model calls or a release command", async () => {
  const f = await budgetPlanFixture(), execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args], {
    env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") },
  });
  try {
    const plan = f.create(), flags = ["--session", f.sessionId, "--filters", '{"status":"held"}'];
    const result = JSON.parse((await execute(["budget", "plans", ...flags])).stdout);
    assert.equal(result.plans[0].id, plan.id); assert.equal(result.plans[0].tokens, 30);
    const calls = JSON.parse((await execute(["budget", "calls", "--session", f.sessionId])).stdout); assert.equal(calls.calls.length, 0);
    await assert.rejects(() => execute(["budget", "release", plan.id]), /Use budget/);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
