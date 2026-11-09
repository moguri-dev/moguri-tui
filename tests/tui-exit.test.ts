import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { isRecord, MoguriError, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui, waitTuiFrame } from "./fixtures/tui-client.ts";

test("exit, /exit and Ctrl+C save the exact TUI draft and disconnect without inference or stopping the shared service", { skip: process.platform !== "darwin" }, async (t) => {
  for (const action of ["exit", "/exit", "ctrl-c"] as const) await t.test(action, async () => {
    const fixture = await setupFixture(), client = await new MoguriSdk(fixture.service.connection).ready();
    const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
    let exited = 0;
    try {
      await fixture.configure();
      flushSync(() => root.render(createElement(TuiApp, { client, initialSessionId: fixture.sessionId, onQuit: () => { exited++; } })));
      await waitTuiFrame(setup, "Write a prompt");
      const text = action === "ctrl-c" ? "Generated unsent text preserved by Ctrl+C." : action;
      await setup.mockInput.typeText(text);
      if (action === "ctrl-c") setup.mockInput.pressKey("c", { ctrl: true }); else setup.mockInput.pressEnter();
      await waitFor(() => exited === 1, 1500);
      assert.equal(fixture.session().draft.text, text);
      assert.equal(fixture.session().messages.length, 0);
      assert.equal(fixture.session().queue.length, 0);
      assert.equal(fixture.requests.length, 0);
      assert.equal(client.getState().status, "disconnected");
      const observer = await new MoguriSdk(fixture.service.connection).ready();
      try { assert.equal(observer.getState().snapshot?.sessions[0]?.id, fixture.sessionId); }
      finally { observer.disconnect(); }
    } finally { await closeTui(root, setup, client, () => fixture.close()); }
  });

  await t.test("repeated Ctrl+C shares one original draft-save exit rather than closing twice", async () => {
    const fixture = await setupFixture(), client = await new MoguriSdk(fixture.service.connection).ready();
    const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
    const gate = Promise.withResolvers<void>(), dispatch = fixture.service.controller.dispatch.bind(fixture.service.controller);
    let entered = false, exited = 0;
    fixture.service.controller.dispatch = async (...args) => {
      const input = args[0];
      if (isRecord(input) && isRecord(input.command) && input.command.type === "draft.save") { entered = true; await gate.promise; }
      return dispatch(...args);
    };
    try {
      await fixture.configure();
      flushSync(() => root.render(createElement(TuiApp, { client, initialSessionId: fixture.sessionId, onQuit: () => { exited++; } })));
      await waitTuiFrame(setup, "Write a prompt");
      await setup.mockInput.typeText("Generated save-guarded TUI draft.");
      setup.mockInput.pressKey("c", { ctrl: true });
      await waitFor(() => entered);
      setup.mockInput.pressKey("c", { ctrl: true });
      assert.equal(exited, 0);
      gate.resolve();
      await waitFor(() => exited > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(exited, 1);
      assert.equal(fixture.session().draft.text, "Generated save-guarded TUI draft.");
      assert.equal(fixture.requests.length, 0);
    } finally { gate.resolve(); fixture.service.controller.dispatch = dispatch; await closeTui(root, setup, client, () => fixture.close()); }
  });
});

test("Ctrl+C leaves an active shared agent working and preserves the exact unsent draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: () => ({ hold: true }) }), client = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  let exited = false;
  try {
    await fixture.configure(); await fixture.send("Generated active owner while terminal leaves."); await waitFor(() => fixture.requests.length === 1);
    flushSync(() => root.render(createElement(TuiApp, { client, initialSessionId: fixture.sessionId, onQuit: () => { exited = true; } })));
    await waitTuiFrame(setup, "Write a prompt"); await setup.mockInput.typeText("Generated unsent active-turn draft.");
    setup.mockInput.pressKey("c", { ctrl: true }); await waitFor(() => exited);
    assert.ok(fixture.session().turnId); assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().draft.text, "Generated unsent active-turn draft.");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "turn.stop_requested"), false);
  } finally { await closeTui(root, setup, client, () => fixture.close()); }
});

test("a failed TUI draft save refuses exit and permits a fresh explicit quit after the save succeeds", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), client = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const dispatch = fixture.service.controller.dispatch.bind(fixture.service.controller);
  let fail = true, exited = 0;
  fixture.service.controller.dispatch = async (...args) => {
    const input = args[0];
    if (fail && isRecord(input) && isRecord(input.command) && input.command.type === "draft.save") throw new MoguriError("generated_save_refusal", "Generated save refused; original terminal draft preserved.");
    return dispatch(...args);
  };
  try {
    await fixture.configure();
    flushSync(() => root.render(createElement(TuiApp, { client, initialSessionId: fixture.sessionId, onQuit: () => { exited++; } })));
    await waitTuiFrame(setup, "Write a prompt"); await setup.mockInput.typeText("Generated draft must not be lost.");
    setup.mockInput.pressKey("c", { ctrl: true });
    await waitTuiFrame(setup, "Generated save refused"); assert.equal(exited, 0); assert.equal(client.getState().status, "connected");
    fail = false; setup.mockInput.pressKey("c", { ctrl: true }); await waitFor(() => exited === 1);
    assert.equal(fixture.session().draft.text, "Generated draft must not be lost."); assert.equal(fixture.requests.length, 0);
  } finally { fixture.service.controller.dispatch = dispatch; await closeTui(root, setup, client, () => fixture.close()); }
});
