import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { remoteMemoryFixture } from "./fixtures/remote-memory-service.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("compiled CLI memory commands use the explicit session's actual SSH boundary and reject conflicting Local selectors", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const f = await remoteMemoryFixture();
  const invoke = (args: string[]) => promisify(execFile)(process.execPath, [resolve("bin/moguri.mjs"), "memory", ...args], { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    await writeFile(join(f.workspace, "knowledge.ts"), "export function generatedInstalledCliKnowledge() { return 'generated remote knowledge'; }\n");
    const before = JSON.parse((await invoke(["state", "--session", f.sessionId])).stdout);
    assert.equal(before.target.env, "Remote"); assert.equal(before.index, null);
    const requested = JSON.parse((await invoke(["index", "--session", f.sessionId])).stdout);
    assert.equal((await f.sdk.jobs.wait(requested.id)).status, "completed");
    const search = JSON.parse((await invoke(["search", "generatedInstalledCliKnowledge", "--session", f.sessionId])).stdout);
    assert.equal(search.binding.root, f.workspace); assert.ok(search.items.some((hit: { text: string }) => hit.text.includes("generatedInstalledCliKnowledge")));
    const graph = JSON.parse((await invoke(["graph", "--session", f.sessionId])).stdout);
    assert.ok(graph.nodes.some((node: { label: string }) => node.label === "generatedInstalledCliKnowledge"));
    await assert.rejects(() => invoke(["index", "--session", f.sessionId, "--project", f.session().projectId]), /do not combine|explicit Local/i);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
