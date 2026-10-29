import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";

async function ready(setup: Awaited<ReturnType<typeof createTestRenderer>>) {
  const deadline = Date.now() + 8000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush();
    if (setup.captureCharFrame().includes("Write a prompt")) return;
  } while (Date.now() < deadline);
  throw new Error(`TUI composer did not become ready:\n${setup.captureCharFrame()}`);
}

test("TUI Enter sends one message in legacy and enhanced keyboard modes without leaving a newline draft", { skip: process.platform !== "darwin" }, async (t) => {
  for (const kittyKeyboard of [false, true]) await t.test(kittyKeyboard ? "enhanced keyboard" : "legacy keyboard", async () => {
    const fixture = await setupFixture(), client = await new MoguriSdk(fixture.service.connection).ready();
    await fixture.configure();
    const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard, exitOnCtrlC: false }), root = createRoot(setup.renderer);
    try {
      flushSync(() => root.render(createElement(TuiApp, { client })));
      await ready(setup);
      await setup.mockInput.typeText("Generated ordinary Enter message.");
      const expected = kittyKeyboard ? "Generated ordinary Enter message.\nGenerated continued line." : "Generated ordinary Enter message.";
      if (kittyKeyboard) {
        setup.mockInput.pressEnter({ shift: true });
        await setup.mockInput.typeText("Generated continued line.");
        await waitFor(() => fixture.session().draft.text === expected);
        assert.equal(fixture.requests.length, 0);
      }
      setup.mockInput.pressEnter();
      const completed = await fixture.terminal();
      assert.equal(completed.status, "completed"); assert.equal(fixture.requests.length, 1);
      assert.equal(completed.messages.find((message) => message.role === "user")?.text, expected);
      assert.equal(completed.draft.text, ""); assert.equal(completed.queue.length, 0);
    } finally { await closeTui(root, setup, client, () => fixture.close()); }
  });
});

test("TUI Shift+Enter inserts a newline and Cmd/Ctrl+Enter still holds the exact multiline draft without inference", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), client = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await ready(setup);
    await setup.mockInput.typeText("Generated first line.");
    setup.mockInput.pressEnter({ shift: true });
    await setup.mockInput.typeText("Generated second line.");
    await waitFor(() => fixture.session().draft.text === "Generated first line.\nGenerated second line.");
    assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.requests.length, 0);
    setup.mockInput.pressKey("j", { ctrl: true });
    await setup.mockInput.typeText("Generated third line.");
    await waitFor(() => fixture.session().draft.text === "Generated first line.\nGenerated second line.\nGenerated third line.");
    setup.mockInput.pressEnter({ ctrl: true });
    const held = await waitFor(() => fixture.session().queue[0]);
    assert.equal(held.held, true); assert.equal(held.text, "Generated first line.\nGenerated second line.\nGenerated third line.");
    assert.equal(fixture.session().turnId, null); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, client, () => fixture.close()); }
});
