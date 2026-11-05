import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { configuredReadinessModels, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { configureGeneratedReadiness, generatedReadinessCollector, generatedReviewedReadinessCollector } from "./fixtures/model-readiness.ts";
import { closeTui } from "./fixtures/tui-client.ts";

test("the actual TUI Models inspector uses shared scoped readiness without selecting a model or consuming its draft", {
  skip: process.platform !== "darwin", timeout: 20_000,
}, async (t) => {
  const fixture = await setupFixture({ exposeModels: false, responseMode: "text", platform: { modelReadiness: { collect: generatedReadinessCollector } } });
  t.after(() => fixture.close());
  const sdk = new MoguriSdk(fixture.service.connection);
  t.after(() => sdk.disconnect());
  await sdk.ready();
  const model = await configureGeneratedReadiness(sdk, fixture);
  assert.equal(model.source, "local");
  await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated unsent runtime-inspection draft.", attachments: [] });
  const terminal = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(terminal.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 15)); await terminal.flush();
      if (terminal.captureCharFrame().includes(text)) return;
    } while (Date.now() < deadline);
    throw new Error(`TUI readiness did not acknowledge ${text}:\n${terminal.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil("Generated unsent runtime-inspection draft.");
    terminal.mockInput.pressKey("m", { ctrl: true });
    await frameUntil("Inspect runtime and hardware");
    const choices = fixture.service.controller.snapshot().provider.models.filter((model) =>
      model.synthetic || !model.environments || model.environments.includes("Local")).length;
    for (let index = 0; index < choices; index++) terminal.mockInput.pressArrow("down");
    terminal.mockInput.pressEnter();
    await frameUntil('"type": "model.readiness"');
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.session().draft.text, "Generated unsent runtime-inspection draft.");
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});

test("the actual TUI requires a separate exact runtime confirmation before its one-use version query", {
  skip: process.platform !== "darwin", timeout: 20_000,
}, async (t) => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect: generatedReviewedReadinessCollector } } });
  t.after(() => fixture.close());
  const sdk = new MoguriSdk(fixture.service.connection);
  t.after(() => sdk.disconnect()); await sdk.ready();
  await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
  const terminal = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(terminal.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 15)); await terminal.flush();
      if (terminal.captureCharFrame().includes(text)) return;
    } while (Date.now() < deadline);
    throw new Error(`TUI runtime review did not acknowledge ${text}:\n${terminal.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil("Write a prompt");
    terminal.mockInput.pressKey("m", { ctrl: true });
    await frameUntil("Review exact runtime version");
    const snapshot = fixture.service.controller.snapshot();
    const choices = snapshot.provider.models.filter((model) => model.synthetic || !model.environments || model.environments.includes("Local")).length;
    for (let index = 0; index < choices + configuredReadinessModels(snapshot.provider.catalogue, "Local").length; index++)
      terminal.mockInput.pressArrow("down");
    terminal.mockInput.pressEnter();
    await frameUntil("Exact runtime version review");
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_executable_reviewed").length, 0);
    terminal.mockInput.pressTab(); await frameUntil("choices focused");
    terminal.mockInput.pressTab({ shift: true }); await frameUntil("preview focused");
    terminal.mockInput.pressTab(); await frameUntil("choices focused");
    terminal.mockInput.pressArrow("down"); terminal.mockInput.pressEnter();
    await frameUntil("Runtime version: build:9911@abcdef01234567");
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_executable_reviewed").length, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 1);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});
