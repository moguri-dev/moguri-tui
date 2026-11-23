import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { Renderable } from "@opentui/core";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { myWorkFixture } from "./my-work-fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const exec = promisify(execFile);
async function frameUntil(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 8000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush();
    if (setup.captureCharFrame().includes(text)) return;
  } while (Date.now() < deadline);
  throw new Error(`Actual My Work frame did not contain ${text}:\n${setup.captureCharFrame()}`);
}
test("compiled CLI uses shared source review, query/filter/refresh/status and exact idle follow-up without writes", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  const cli = async (...args: string[]) => {
    const { stdout } = await exec(process.execPath, [resolve("bin/moguri.mjs"), "my-work", ...args], {
      cwd: process.cwd(), env: { ...process.env, MOGURI_STATE_DIR: f.stateDir }, timeout: 10000,
    });
    return JSON.parse(stdout);
  };
  try {
    const before = f.calls.length;
    assert.equal((await cli("query")).total, 0); assert.equal(f.calls.length, before);
    const { preview } = await cli("source", f.projectId);
    await cli("configure", f.projectId, "--digest", preview.digest, "--confirm-review");
    const admitted = await cli("refresh"); await cli("wait", admitted.id);
    const inbox = await cli("query", "--filters", '{"category":"pending-review"}');
    assert.equal(inbox.total, 1); assert.equal(inbox.entries[0].associations[0].source.accountId, "generated-a:42");
    assert.equal((await cli("status")).refreshes.length, 1);
    const item = inbox.entries[0], sourceId = item.associations[0].source.id;
    assert.deepEqual((await cli("navigate", item.id, sourceId)).navigation.sessionIds, []);
    const followup = await cli("followup", item.id, sourceId);
    const session = await cli("start", item.id, sourceId, "--digest", followup.digest, "--confirm-review");
    assert.equal(f.service.controller.snapshot().sessions.find((sessionValue) => sessionValue.id === session.id)?.turnId, null);
    assert.equal(f.service.controller.snapshot().sessions.at(-1)?.githubSource?.accountId, "generated-a:42");
    assert.ok(f.calls.every((call) => call.method === "GET" || call.path === "graphql"));
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
  } finally { await f.close(); }
});
test("actual native TUI My Work tab reads retained items and explicitly reviews a follow-up without polling or inference", {
  skip: process.platform !== "darwin", timeout: 30000,
}, async () => {
  const f = await myWorkFixture(), setup = await createTestRenderer({ width: 160, height: 70, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await f.configure(f.first); const refresh = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(refresh.id!);
    const reads = f.calls.length;
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk })));
    await frameUntil(setup, "Write a prompt");
    const tab = setup.renderer.root.findDescendantById("tui-tab-my-work");
    assert.ok(tab instanceof Renderable); await setup.mockMouse.click(tab.x + 4, tab.y);
    await frameUntil(setup, "My Work /"); await frameUntil(setup, "Generated inbox-a work");
    assert.equal(f.calls.length, reads);
    setup.mockInput.pressEnter(); await frameUntil(setup, "Generated full PR body.");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressArrow("down"); setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Confirm idle follow-up session");
    assert.equal(f.service.controller.snapshot().sessions.length, 1);
    setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await waitFor(() => f.service.controller.snapshot().sessions.length === 2);
    const created = f.service.controller.snapshot().sessions.at(-1)!;
    assert.equal(created.githubSource?.accountId, "generated-a:42"); assert.equal(created.turnId, null);
    assert.ok(created.draft.text.includes("Generated full PR body."));
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "model.started"), false);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
  } finally { await closeTui(root, setup, f.sdk, () => f.close()); }
});
test("native queued /my-work commits the actual filtered inbox frame and leaves original input out of model context", {
  skip: process.platform !== "darwin", timeout: 30000,
}, async () => {
  const f = await myWorkFixture(), setup = await createTestRenderer({ width: 150, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await f.configure(f.first); await f.configure(f.second); f.first.checks[0]!.conclusion = "startup_failure";
    const refresh = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(refresh.id!);
    const reads = f.calls.length;
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText('/my-work query {"category":"failed-ci"}'); setup.mockInput.pressEnter();
    await frameUntil(setup, "1 matching PRs");
    await waitFor(() => f.service.controller.snapshot().commandExecutions.some((execution) => execution.name === "my-work" && execution.status === "completed"));
    assert.equal(f.calls.length, reads);
    assert.equal(f.service.controller.snapshot().sessions[0]!.turnId, null);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "model.started"), false);
    assert.equal(setup.captureCharFrame().includes("Generated inbox-b work"), false);
  } finally { await closeTui(root, setup, f.sdk, () => f.close()); }
});
