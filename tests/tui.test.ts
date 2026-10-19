import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { mkdir, writeFile } from "node:fs/promises";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk as MoguriClient } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("the actual OpenTUI client selects Copilot, streams, stops and receives a second client's draft", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = new MoguriClient(fixture.service.connection);
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (predicate: (frame: string) => boolean) => {
    const deadline = Date.now() + 8000;
    let frame = "";
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.flush();
      frame = setup.captureCharFrame();
      if (predicate(frame)) return frame;
    } while (Date.now() < deadline);
    throw new Error(`TUI did not settle:\n${frame}`);
  };
  try {
    await client.connect();
    await waitFor(() => client.getState().status === "connected");
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil((frame) => frame.includes("Model not set") && frame.includes("Budget Unlimited"));
    setup.mockInput.pressKey("m", { ctrl: true });
    await frameUntil((frame) => frame.includes("Generated Copilot model"));
    setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().controls.modelId === fixture.modelId);
    await frameUntil((frame) => frame.includes(fixture.modelId) && frame.includes("Write a prompt"));
    await setup.mockInput.typeText("generated slow task");
    setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await waitFor(() => fixture.requests.length === 1);
    await frameUntil((frame) => frame.includes("Generated work in progress."));
    setup.mockInput.pressCtrlC();
    assert.equal((await fixture.terminal()).status, "stopped");
    await frameUntil((frame) => frame.includes("stopped"));
    await fixture.service.controller.dispatch(envelope({
      type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "generated draft from desktop", attachments: [],
    }));
    const frame = await frameUntil((frame) => frame.includes("generated draft from desktop"));
    await mkdir(".moguri/artifacts", { recursive: true });
    await writeFile(".moguri/artifacts/tui-session.txt", frame);
  } finally {
    client.disconnect();
    flushSync(() => root.unmount());
    await setup.dispose();
    await fixture.close();
  }
});

test("the actual TUI creates local issues and masks Linear credentials without sending a model turn", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 20)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/issue create bug Generated terminal ticket");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Local project Kanban");
    await frameUntil("Generated terminal ticket");
    assert.equal(fixture.service.controller.snapshot().issues[0]?.kind, "bug");
    setup.mockInput.pressEscape();
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/linear token");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Linear personal API key");
    await setup.mockInput.typeText("generated-linear-masked");
    await frameUntil("********");
    assert.equal(setup.captureCharFrame().includes("generated-linear-masked"), false);
    assert.equal(fixture.session().draft.text.includes("generated-linear-masked"), false);
    setup.mockInput.pressEscape();
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI views, edits and restores the SDK system prompt with an explicit warning", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = new MoguriClient(fixture.service.connection);
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (predicate: (frame: string) => boolean) => {
    const deadline = Date.now() + 8000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 20)); await setup.flush();
      if (predicate(setup.captureCharFrame())) return;
    } while (Date.now() < deadline);
    throw new Error(`TUI settings did not settle:\n${setup.captureCharFrame()}`);
  };
  try {
    await client.ready();
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil((frame) => frame.includes("Budget Unlimited"));
    setup.mockInput.pressKey("g", { ctrl: true });
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    setup.mockInput.pressEnter();
    await frameUntil((frame) => frame.includes("can break tool use") && frame.includes("Ctrl+Enter acknowledges risk"));
    await setup.mockInput.typeText("Generated TUI instruction. ");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    await waitFor(() => fixture.service.controller.snapshot().settings.values.systemPrompt.includes("Generated TUI instruction."));
    setup.mockInput.pressEnter();
    await frameUntil((frame) => frame.includes("Ctrl+Enter acknowledges risk"));
    setup.mockInput.pressKey("r", { ctrl: true });
    await waitFor(() => fixture.service.controller.snapshot().settings.values.systemPrompt === fixture.service.controller.snapshot().settings.defaults.systemPrompt);
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    setup.mockInput.pressEscape();
    await frameUntil((frame) => frame.includes("Write a prompt"));
    await setup.mockInput.typeText("/mcp token generated-auth");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil((frame) => frame.includes("MCP credential for generated-auth"));
    await setup.mockInput.typeText("generated-test-secret");
    await frameUntil((frame) => frame.includes("********"));
    assert.equal(setup.captureCharFrame().includes("generated-test-secret"), false);
    assert.equal(fixture.session().draft.text.includes("generated-test-secret"), false);
    setup.mockInput.pressEscape();
    assert.equal(fixture.requests.length, 0);
  } finally {
    client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close();
  }
});

test("the actual TUI holds Cmd/Ctrl+Enter prompts and shares read-only, rename, copy and side commands", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 100, height: 38, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const copied: string[] = [];
  const native = { copy: async (text: string) => { copied.push(text); }, browser: async () => { throw new Error("No external browser in this generated test."); }, file: async () => { throw new Error("No external app in this generated test."); } };
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string) => { await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client, native })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated first held prompt");
    setup.mockInput.pressEnter({ super: true });
    await waitFor(() => fixture.session().queue.length === 1);
    await frameUntil("1 queued");
    await setup.mockInput.typeText("Generated second held prompt");
    setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => fixture.session().queue.length === 2);
    assert.ok(fixture.session().queue.every((item) => item.held));
    assert.equal(fixture.requests.length, 0);
    await slash("/read-only");
    await waitFor(() => fixture.session().mode === "read-only");
    await frameUntil("read-only");
    await slash("/rename Generated terminal name");
    await waitFor(() => fixture.session().title === "Generated terminal name");
    await slash(`/copy ${fixture.session().queue[0]!.id}`);
    await waitFor(() => copied.length === 1);
    assert.deepEqual(copied, ["Generated first held prompt"]);
    await slash("/side");
    const side = await waitFor(() => client.getState().snapshot?.sessions.find((session) => session.kind === "side"));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated held side question");
    setup.mockInput.pressEnter({ super: true });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.queue.length === 1);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.queue[0]?.held, true);
    await slash("/termnial");
    await frameUntil("already a terminal");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
