import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import * as sdkModule from "../packages/sdk/src/index.ts";
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
