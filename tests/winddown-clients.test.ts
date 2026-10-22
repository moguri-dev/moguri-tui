import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { winddownApiFixture } from "./fixtures/winddown-api.ts";

test("shared CLI/TUI checkpoint review cannot turn model output into Git authority; exact actual-user confirmation publishes only accepted work", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const f = await winddownApiFixture({ git: true });
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "winddown", ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    const accepted = await f.accept(), checkpoint = await f.run();
    assert.equal(JSON.parse((await cli(["read", checkpoint.winddown.id])).stdout).winddown.status, "ready");
    const input = { winddownId: checkpoint.winddown.id, candidateIds: [accepted.candidate.id], branch: "moguri/generated-terminal-budget-checkpoint", message: "chore: retain accepted terminal checkpoint" };
    const file = join(f.directory, "generated-budget-git-review.json"); await writeFile(file, JSON.stringify(input));
    const preview = await f.sdk.slash(f.sessionId, "/winddown commit-preview " + JSON.stringify(input), "tui");
    assert.ok(preview.kind === "text");
    const value = JSON.parse(preview.text);
    await assert.rejects(() => cli(["commit", file, "--session", f.sessionId, "--revision", String(value.preview.revision), "--digest", value.preview.digest]), /confirm-git/);
    const result = await f.sdk.slash(f.sessionId, value.confirmCommand, "tui"); assert.ok(result.kind === "text");
    assert.equal(JSON.parse(result.text).winddown.status, "completed");
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.requests.length, 1);
    await assert.rejects(() => f.sdk.slash(f.sessionId, "/winddown commit-preview " + JSON.stringify({ ...input, sessionId: "generated-forged-root-owner" }), "tui"), /session|scope|root|override/i);
  } finally { await f.close(); }
});
