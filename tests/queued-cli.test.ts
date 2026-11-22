import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture, waitFor } from "./fixture.ts";

test("the actual CLI queues behind a running model and its service-capable command finishes after the CLI exits", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    await fixture.configure(); await fixture.send("generated slow original CLI queue turn"); await waitFor(() => fixture.requests.length === 1);
    const submitted = JSON.parse((await execute(["slash", "/theme rose", "--session", fixture.sessionId])).stdout);
    assert.equal(submitted.queued, true); assert.equal(fixture.session().queue[0]?.command?.client, "cli");
    assert.equal(fixture.service.controller.snapshot().settings.values.appearance.palette, "moguri");
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.service.controller.snapshot().settings.values.appearance.palette === "rose");
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the actual CLI holds yolo without a model and exposes unsupported UI delivery without falsely acknowledging it", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    const held = JSON.parse((await execute(["slash", "/yolo", "--session", fixture.sessionId, "--hold"])).stdout);
    assert.equal(held.held, true); assert.equal(fixture.session().queue[0]?.command?.name, "yolo");
    assert.equal(fixture.session().controls.autonomy, "Manual"); assert.equal(fixture.session().controls.modelId, null);
    const view = JSON.parse((await execute(["slash", "/settings", "--session", fixture.sessionId])).stdout);
    assert.equal(view.status, "waiting-client"); assert.equal(view.result.panel, "Settings");
    const retained = JSON.parse((await execute(["commands", "read", view.executionId])).stdout);
    assert.equal(retained.execution.status, "waiting-client"); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().controls.autonomy, "Manual");
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
  } finally { sdk.disconnect(); await fixture.close(); }
});
