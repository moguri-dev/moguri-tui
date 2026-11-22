import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";

test("native TUI idle Hold reviews a schedule and Automations sends only the original prompt", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await fixture.configure(); await sdk.refresh();
  const terminal = await createTestRenderer({ width: 120, height: 45, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  const until = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await terminal.flush(); if (terminal.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not render ${text}:\n${terminal.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await until("Write a prompt");
    await terminal.mockInput.typeText("Generated scheduled TUI original."); terminal.mockInput.pressEnter({ ctrl: true });
    await until("Send now instead of scheduling?");
    terminal.mockInput.pressArrow("down"); terminal.mockInput.pressEnter();
    await until("5 minutes"); terminal.mockInput.pressEnter();
    await waitFor(() => fixture.service.controller.snapshot().scheduledPrompts[0]?.status === "scheduled");
    await until("not sent"); assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().messages.length, 0);
    await terminal.mockInput.typeText("Generated preserved TUI draft.");
    terminal.mockInput.pressKey("F9"); await until("Automations / Scheduled prompts"); terminal.mockInput.pressEnter();
    await waitFor(() => fixture.requests.length === 1); await fixture.terminal();
    terminal.mockInput.pressEscape(); await until("Generated preserved TUI draft.");
    assert.equal(fixture.session().draft.text, "Generated preserved TUI draft.");
    assert.equal(fixture.service.controller.snapshot().scheduledPrompts[0]?.status, "admitted");
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});
