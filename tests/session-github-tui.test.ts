import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { setupFixture, waitFor } from "./fixture.ts";

async function frameUntil(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 8000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush();
    if (setup.captureCharFrame().includes(text)) return;
  } while (Date.now() < deadline);
  throw new Error(`Native workflow did not render ${text}:\n${setup.captureCharFrame()}`);
}

test("native TUI pickers discover repositories and review complete project issues before starting an idle source-bound session", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const fixture = await githubApplicationFixture(), setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frame = (text: string) => frameUntil(setup, text);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frame("Write a prompt"); await setup.mockInput.typeText("/github repos"); setup.mockInput.pressEnter({ ctrl: true });
    await frame("GitHub repositories / generated-owner");
    setup.mockInput.pressEnter(); await frame("Clone generated-owner/fixture");
    setup.mockInput.pressEscape(); await frame("Write a prompt");
    await setup.mockInput.typeText("/github issues"); setup.mockInput.pressEnter({ ctrl: true });
    await frame("generated-owner/fixture / Issues"); setup.mockInput.pressEnter();
    await frame("Generated **issue body**."); setup.mockInput.pressKey("n", { ctrl: true });
    await waitFor(() => fixture.service.controller.snapshot().sessions.length === 2);
    const session = fixture.service.controller.snapshot().sessions.at(-1)!;
    assert.equal(session.workItemUrl, "https://github.com/generated-owner/fixture/issues/7");
    assert.ok(session.draft.text.includes("Generated **issue body**.")); assert.equal(session.turnId, null);
    assert.equal(fixture.git(["branch", "--show-current"]), "generated-feature"); assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("native TUI remembered approval choices share project grants with later turns and other SDK clients", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await fixture.configure();
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await fixture.send("generated tool TUI remembered approval"); await waitFor(() => fixture.session().pendingApproval);
    await frameUntil(setup, "Approval required");
    setup.mockInput.pressKey("y", { ctrl: true, shift: true });
    await frameUntil(setup, "Approve for this project");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.approvals.list()[0]?.scope.kind, "project");
    await fixture.send("generated tool TUI remembered again"); assert.equal((await fixture.terminal()).status, "completed");
  } finally { flushSync(() => root.unmount()); await setup.dispose(); sdk.disconnect(); await fixture.close(); }
});
