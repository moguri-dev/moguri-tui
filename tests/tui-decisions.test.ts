import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { setupDecisions } from "./fixtures/decisions-api.ts";
import { waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";

test("actual TUI keys send Max work, inspect bounded provider evidence through shared slash and edit only independent report metadata", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const f = await setupDecisions(), setup = await createTestRenderer({ width: 180, height: 90, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 5000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter(); await frameUntil(expected); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk })));
    await slash("/decisions status", '"decisions.status"'); setup.mockInput.pressEscape();
    await frameUntil("Write a prompt"); await setup.mockInput.typeText("generated tool actual TUI bounded decision");
    setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await waitFor(() => f.service.controller.snapshot().decisions[0]?.status === "applied"); await f.terminal(); await f.sdk.refresh();
    const record = f.sdk.decisions.list(f.sessionId)[0]; assert.ok(record);
    await slash(`/decisions read ${record.id}`, '"decisions.read"'); await frameUntil('"applied"'); setup.mockInput.pressEscape();
    await slash(`/artifact edit ${record.id}`, "Decision metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI decision report", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await f.sdk.artifacts.read(record.id)).artifact.name, "Generated TUI decision report");
    assert.equal((await f.sdk.decisions.read(record.id)).decision.status, "applied");
    assert.equal(f.requests.length, 2); assert.equal(f.advice.requests.length, 1);
  } finally { await closeTui(root, setup, f.sdk, () => f.close()); }
});
