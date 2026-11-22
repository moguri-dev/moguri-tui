import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import * as sdkModule from "@moguri-dev/sdk";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { closeTui, waitTuiFrame } from "./fixtures/tui-client.ts";
import { setupFixture } from "./fixture.ts";

test("shared CLI/TUI OTLP commands require the exact reviewed JSON and explicit confirmation without a session or model", async () => {
  const fixture = await setupFixture(), sdk = await new sdkModule.MoguriSdk(fixture.service.connection).ready();
  try {
    const disabled = await sdkModule.executeOtlpCommand(sdk, "status");
    assert.ok(disabled.type === "telemetry.export.status"); assert.equal(disabled.configuration.enabled, false);
    const reviewed = await sdkModule.executeOtlpCommand(sdk, 'review {"enabled":true,"endpoint":"http://127.0.0.1:4318","samplingRatio":0.1}');
    assert.ok(reviewed.type === "telemetry.export.review");
    const json = JSON.stringify(reviewed.review);
    await assert.rejects(sdkModule.executeOtlpCommand(sdk, `apply ${json}`), /confirm-reviewed/);
    await sdkModule.executeOtlpCommand(sdk, `apply ${json} confirm-reviewed`);
    assert.equal((await sdk.telemetry.export.status()).configuration.enabled, true);
    const off = await sdk.telemetry.export.review({ enabled: false, endpoint: null, samplingRatio: 1 });
    await sdk.telemetry.export.apply(off.review);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the built CLI shares explicit OTLP review and apply without a model or session binding", async () => {
  const fixture = await setupFixture(), sdk = await new sdkModule.MoguriSdk(fixture.service.connection).ready();
  const cli = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "telemetry", "otlp", ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") }, timeout: 10_000 })).stdout);
  try {
    assert.equal((await cli("status")).configuration.enabled, false);
    const review = await cli("review", '{"enabled":true,"endpoint":"http://127.0.0.1:4318","samplingRatio":0.5}');
    await cli("apply", JSON.stringify(review.review), "confirm-reviewed");
    assert.equal((await sdk.telemetry.export.status()).configuration.samplingRatio, 0.5);
    const off = await sdk.telemetry.export.review({ enabled: false, endpoint: null, samplingRatio: 1 }); await sdk.telemetry.export.apply(off.review);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("credential values never travel in shared commands; the CLI reads them from piped stdin into this profile's secret backend", async () => {
  const fixture = await setupFixture(), sdk = await new sdkModule.MoguriSdk(fixture.service.connection).ready(), endpoint = "http://127.0.0.1:4318";
  const run = (args: string[], input?: string) => new Promise<string>((done, fail) => {
    const child = execFile(process.execPath, [resolve("dist/cli.mjs"), "telemetry", "otlp", ...args],
      { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") }, timeout: 10_000 }, (error, stdout, stderr) => error ? fail(new Error(stderr || error.message)) : done(stdout));
    child.stdin?.end(input ?? "");
  });
  try {
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: false, endpoint, samplingRatio: 1, headers: ["authorization"] })).review);
    await assert.rejects(sdkModule.executeOtlpCommand(sdk, `credential set ${endpoint} authorization GENERATED_PRIVATE_COMMAND_SECRET`), /never go in a command line/);
    await run(["credential", "set", endpoint, "authorization"], "Bearer GENERATED_PRIVATE_STDIN_SECRET\n");
    assert.deepEqual((await sdk.telemetry.export.status()).headers, [{ name: "authorization", stored: true }]);
    await sdkModule.executeOtlpCommand(sdk, `credential remove ${endpoint} authorization`);
    assert.deepEqual((await sdk.telemetry.export.status()).headers, [{ name: "authorization", stored: false }]);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_PRIVATE"), false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the actual empty TUI reviews metadata export without creating a chat, choosing a model or enabling it", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), client = await new sdkModule.MoguriSdk(fixture.service.connection).ready();
  await client.sessions.delete(fixture.sessionId, true);
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await waitTuiFrame(setup, "/new global  /open PATH");
    await setup.mockInput.typeText('/otlp review {"enabled":true,"endpoint":"http://127.0.0.1:4318","samplingRatio":0.1}');
    setup.mockInput.pressEnter();
    await waitTuiFrame(setup, '"transport": "otlp-http-json"');
    assert.equal((await client.telemetry.export.status()).configuration.enabled, false);
    assert.equal(fixture.service.controller.snapshot().sessions.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, client, () => fixture.close()); }
});
