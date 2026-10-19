import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { setupFixture } from "./fixture.ts";

test("the CLI creates and moves local tickets through the same SDK with explicit revision conflicts", async () => {
  const fixture = await setupFixture();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const path = join(fixture.directory, "generated-issue.json");
    await writeFile(path, JSON.stringify({ title: "Generated CLI issue", body: "Generated only", kind: "misc", phaseId: "backlog", pullRequestUrl: null }));
    const created = JSON.parse((await execute(["issues", "create", fixture.session().projectId, path])).stdout);
    assert.equal(fixture.service.controller.snapshot().issues[0]?.title, "Generated CLI issue");
    await execute(["issues", "move", created.id, "in-progress", "--revision", "0"]);
    await assert.rejects(() => execute(["issues", "move", created.id, "done", "--revision", "0"]), /Another client/);
    const board = JSON.parse((await execute(["issues", "list", fixture.session().projectId])).stdout);
    assert.equal(board.issues[0].phaseId, "in-progress");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
