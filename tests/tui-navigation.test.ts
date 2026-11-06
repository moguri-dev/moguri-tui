import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliRenderEvents, Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp, waitForCommandFrame } from "../apps/tui/src/App.tsx";
import { appearanceColors, colorContrast, MoguriSdk, themePalettes, type PlatformQuery, type PlatformResponse } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { closeTui } from "./fixtures/tui-client.ts";

type Terminal = Awaited<ReturnType<typeof createTestRenderer>>;
async function frameUntil(setup: Terminal, text: string) {
  const deadline = Date.now() + 8000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush();
    if (setup.captureCharFrame().includes(text)) return;
  } while (Date.now() < deadline);
  throw new Error(`TUI did not render ${text}:\n${setup.captureCharFrame()}`);
}
async function click(setup: Terminal, id: string) {
  await setup.flush();
  const target = setup.renderer.root.findDescendantById(id);
  assert.ok(target instanceof Renderable, `Actual terminal hit target ${id} is missing`);
  assert.ok(target.width > 0 && target.height > 0);
  await setup.mockMouse.click(target.x + Math.floor(target.width / 2), target.y + Math.floor(target.height / 2));
  await setup.flush();
}

test("an actually presented command frame remains acknowledged when navigation changes before the idle waiter resumes", { skip: process.platform !== "darwin", timeout: 5000 }, async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  let visible = true, presented = false;
  try {
    flushSync(() => root.render(createElement("text", { id: "generated-command-frame" }, "Generated actual command view")));
    const waiting = waitForCommandFrame(setup.renderer, AbortSignal.timeout(750), () => visible &&
      setup.renderer.root.findDescendantById("generated-command-frame")?.visible === true);
    setup.renderer.once(CliRenderEvents.FRAME, () => {
      presented = true; visible = false;
      flushSync(() => root.render(createElement("text", null, "Generated actual user navigation")));
    });
    await waiting;
    assert.equal(presented, true); assert.equal(visible, false);
    await setup.flush(); assert.ok(setup.captureCharFrame().includes("Generated actual user navigation"));
  } finally { flushSync(() => root.unmount()); await setup.dispose(); }
});

test("an unrelated native frame cannot acknowledge an unseen command and removes its original listener on cancellation", { skip: process.platform !== "darwin", timeout: 5000 }, async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const listeners = setup.renderer.listenerCount(CliRenderEvents.FRAME);
  try {
    flushSync(() => root.render(createElement("text", null, "Generated unrelated visible frame")));
    await assert.rejects(() => waitForCommandFrame(setup.renderer, AbortSignal.timeout(100), () => false), /aborted|timed out/i);
    assert.equal(setup.renderer.listenerCount(CliRenderEvents.FRAME), listeners);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); }
});

test("cancellation after a matching native frame still refuses success when its original owner ended before acknowledgement", { skip: process.platform !== "darwin", timeout: 5000 }, async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, exitOnCtrlC: false }), root = createRoot(setup.renderer), abort = new AbortController();
  try {
    flushSync(() => root.render(createElement("text", null, "Generated presented view before owned stop")));
    const waiting = waitForCommandFrame(setup.renderer, abort.signal, () => true);
    setup.renderer.once(CliRenderEvents.FRAME, () => abort.abort(new Error("Generated original command owner stopped.")));
    await assert.rejects(() => waiting, (error: unknown) => {
      assert.ok(error === abort.signal.reason || error instanceof Error && "cause" in error && error.cause === abort.signal.reason);
      return true;
    });
  } finally { flushSync(() => root.unmount()); await setup.dispose(); }
});

test("native terminal mouse tabs navigate real screens and preserve the exact unsent draft without inference", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("Generated unsent navigation draft.");
    await click(setup, "tui-tab-sessions"); await frameUntil(setup, "Choose a session");
    await click(setup, "tui-tab-work-items"); await frameUntil(setup, "Project work item");
    await click(setup, "tui-tab-code-requests"); await frameUntil(setup, "Session code requests");
    await click(setup, "tui-tab-session"); await frameUntil(setup, "Generated unsent navigation draft.");
    assert.equal(fixture.session().draft.text, "Generated unsent navigation draft.");
    assert.equal(fixture.session().turnId, null); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.session().pendingApproval, null);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("sidebar arrows are confined to navigation focus and remain usable after narrow terminal resizing", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("abc"); setup.mockInput.pressArrow("left"); await setup.mockInput.typeText("X");
    await waitFor(() => fixture.session().draft.text === "abXc");
    assert.equal(setup.renderer.root.findDescendantById("tui-sidebar")?.visible, true);
    setup.mockInput.pressTab(); await frameUntil(setup, "Left/Right sidebar");
    setup.mockInput.pressArrow("left"); await waitFor(() => setup.renderer.root.findDescendantById("tui-sidebar")?.visible === false); await setup.flush();
    assert.equal(setup.renderer.root.findDescendantById("tui-sidebar")?.visible, false);
    setup.mockInput.pressArrow("right"); await waitFor(() => setup.renderer.root.findDescendantById("tui-sidebar")?.visible === true); await setup.flush();
    assert.equal(setup.renderer.root.findDescendantById("tui-sidebar")?.visible, true);
    setup.mockInput.pressArrow("left"); await waitFor(() => setup.renderer.root.findDescendantById("tui-sidebar")?.visible === false); setup.mockInput.pressEscape();
    setup.resize(52, 24); await frameUntil(setup, "/help commands");
    await frameUntil(setup, "Env Local | Model");
    await frameUntil(setup, "Autonomy level Manual | Budget Unlimited");
    for (const tab of ["session", "sessions", "work-items", "code-requests"]) {
      const target = setup.renderer.root.findDescendantById(`tui-tab-${tab}`);
      assert.ok(target instanceof Renderable);
      assert.ok(target.x >= 0 && target.x + target.width <= 52);
      assert.ok(target.y >= 0 && target.y + target.height <= 24);
    }
    await click(setup, "tui-tab-code-requests"); await frameUntil(setup, "Session code requests");
    await click(setup, "tui-tab-session"); await frameUntil(setup, "abXc");
    setup.mockInput.pressTab(); await frameUntil(setup, "Left/Right sidebar");
    setup.mockInput.pressArrow("right"); await waitFor(() => setup.renderer.root.findDescendantById("tui-sidebar")?.visible === true); await setup.flush();
    assert.equal(setup.renderer.root.findDescendantById("tui-sidebar")?.visible, true);
    setup.mockInput.pressArrow("left"); setup.mockInput.pressEscape(); await frameUntil(setup, "abXc");
    assert.equal(fixture.session().draft.text, "abXc"); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("slash discovery fills with terminal keyboard or mouse but executes navigation only on explicit Enter", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/ses"); await frameUntil(setup, "Tab or click fills");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressTab();
    await waitFor(() => fixture.session().draft.text === "/sessions ");
    await setup.flush();
    assert.equal(setup.captureCharFrame().includes("Choose a session"), false);
    setup.mockInput.pressEnter(); await frameUntil(setup, "Choose a session");
    await click(setup, "tui-tab-session"); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/code"); await frameUntil(setup, "Tab or click fills");
    await click(setup, "tui-command-code-requests");
    await waitFor(() => fixture.session().draft.text === "/code-requests ");
    await setup.flush();
    assert.equal(setup.captureCharFrame().includes("Session code requests"), false);
    setup.mockInput.pressEnter(); await frameUntil(setup, "Session code requests");
    setup.mockInput.pressEscape(); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/theme terminal"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Theme set to terminal / dark");
    assert.equal(sdk.settings.get()?.values.appearance.palette, "terminal");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().queue.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("terminal tab and sidebar navigation cannot answer or approve a pending action", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await reviewNativeTools(fixture, ["read_file"]); await fixture.configure();
  const setup = await createTestRenderer({ width: 120, height: 48, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await fixture.send("generated tool navigation approval");
    const approval = await waitFor(() => fixture.session().pendingApproval); await frameUntil(setup, "Approval required");
    await setup.mockInput.typeText("Generated draft while approval waits.");
    for (const tab of ["sessions", "work-items", "code-requests", "session"]) await click(setup, `tui-tab-${tab}`);
    setup.mockInput.pressTab(); setup.mockInput.pressArrow("left"); setup.mockInput.pressArrow("right"); setup.mockInput.pressEscape();
    await frameUntil(setup, "Generated draft while approval waits.");
    assert.equal(fixture.session().pendingApproval?.id, approval.id);
    assert.equal(fixture.session().draft.text, "Generated draft while approval waits.");
    assert.equal(fixture.requests.length, 1);
    await sdk.approvals.respond(fixture.sessionId, approval.id, false); await fixture.terminal();
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("mouse navigation refuses to discard a local settings editor", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/settings edit"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Ctrl+Enter acknowledges risk");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText("Generated unsaved settings edit");
    await click(setup, "tui-tab-code-requests"); await frameUntil(setup, "Save or discard this editor");
    assert.ok(setup.captureCharFrame().includes("Generated unsaved settings edit"));
    assert.equal(setup.captureCharFrame().includes("Session code requests"), false);
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native terminal cells follow shared preset updates in both modes and actual terminal System reports", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const selectedColors = async () => {
    await setup.flush(); await setup.waitForVisualIdle();
    const target = setup.renderer.root.findDescendantById("tui-tab-session");
    assert.ok(target instanceof Renderable);
    const point = target.x + 3;
    let column = 0;
    for (const span of setup.captureSpans().lines[target.y]!.spans) {
      column += span.width;
      if (column > point) {
        const hex = (color: typeof span.fg) => "#" + color.toInts().slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("");
        return { foreground: hex(span.fg), background: hex(span.bg) };
      }
    }
    throw new Error("The native selected-tab cell was not rendered.");
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    for (const theme of ["dark", "light"] as const) for (const { id } of themePalettes.filter((entry) => entry.id !== "custom")) {
      const current = sdk.settings.get()!;
      await sdk.settings.update({ ...current.values, appearance: { ...current.values.appearance, theme, palette: id } }, current.revision);
      const actual = await selectedColors(), expected = appearanceColors({ theme, palette: id }, theme);
      assert.deepEqual(actual, { foreground: expected.selectionText, background: expected.selected }, `${id} ${theme}`);
      assert.ok(colorContrast(actual.foreground, actual.background) >= 4.5, `${id} ${theme}`);
    }
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, appearance: { theme: "system", palette: "crystal" } }, current.revision);
    flushSync(() => { setup.renderer.emit("theme_mode", "light"); });
    assert.deepEqual(await selectedColors(), { foreground: "#183a70", background: "#dce6fa" });
    flushSync(() => { setup.renderer.emit("theme_mode", "dark"); });
    assert.deepEqual(await selectedColors(), { foreground: "#f0f3ff", background: "#304572" });
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("an empty terminal workspace supports slash onboarding without an inferred project or model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await sdk.sessions.delete(fixture.sessionId, true);
  const setup = await createTestRenderer({ width: 90, height: 36, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "/new global  /open PATH");
    await setup.mockInput.typeText("/help"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Commands / no shortcut chords");
    setup.mockInput.pressEscape(); await frameUntil(setup, "/new global  /open PATH");
    await setup.mockInput.typeText("/new global"); setup.mockInput.pressEnter();
    const created = await waitFor(() => sdk.getState().snapshot?.sessions[0]);
    assert.equal(created.projectId, null); assert.equal(created.turnId, null); assert.equal(created.controls.modelId, null);
    await frameUntil(setup, "Write a prompt"); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("work-item and code-request tabs operate the actual bound Kanban and Git diff without consuming the draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), git = initializeGeneratedRepository(fixture.project);
  const originalHead = git(["rev-parse", "HEAD"]);
  const card = await sdk.issues.create(fixture.session().projectId, { title: "Generated terminal card", body: "Generated work item.", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
  await writeFile(join(fixture.project, "fixture.txt"), "Generated TUI tab code change.\n");
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("Generated preserved work draft.");
    await click(setup, "tui-tab-work-items"); await frameUntil(setup, "Generated terminal card");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().workItemId === card.id); await frameUntil(setup, "Generated preserved work draft.");
    await click(setup, "tui-tab-code-requests"); await frameUntil(setup, "Review current code changes");
    setup.mockInput.pressEnter(); await frameUntil(setup, "+Generated TUI tab code change.");
    assert.equal(fixture.session().draft.text, "Generated preserved work draft.");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().turnId, null);
    assert.equal(git(["rev-parse", "HEAD"]), originalHead); assert.equal(git(["diff", "--cached"]), "");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("batched keyboard navigation cannot submit a configured session's existing prompt before focus renders", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await fixture.configure();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("Generated guarded navigation prompt.");
    setup.mockInput.pressTab(); setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Choose a session");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().turnId, null);
    assert.equal(fixture.session().draft.text, "Generated guarded navigation prompt.");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native terminal notices are informational and dismiss by X or Escape without consuming the draft", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("Generated unchanged notice draft.");
    await waitFor(() => fixture.session().draft.text === "Generated unchanged notice draft.");
    setup.mockInput.pressKey("F6"); await frameUntil(setup, "No actual pending question");
    assert.ok(setup.renderer.root.findDescendantById("tui-alert-info"));
    await click(setup, "tui-alert-dismiss"); await setup.flush();
    assert.equal(setup.captureCharFrame().includes("No actual pending question"), false);
    setup.mockInput.pressKey("F6"); await frameUntil(setup, "No actual pending question");
    setup.mockInput.pressEscape(); await waitFor(() => !setup.renderer.root.findDescendantById("tui-alert-info")); await setup.flush();
    assert.equal(setup.captureCharFrame().includes("No actual pending question"), false);
    assert.equal(fixture.session().draft.text, "Generated unchanged notice draft.");
    assert.equal(fixture.session().turnId, null); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native terminal slash actions use the shared ordered queue and actual rendered-view acknowledgement", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await fixture.configure();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/theme rose"); setup.mockInput.pressEnter({ ctrl: true });
    const theme = await waitFor(() => fixture.session().queue.find((entry) => entry.command?.name === "theme"));
    assert.equal(theme.held, true); assert.equal(fixture.session().draft.text, "");
    assert.equal(sdk.settings.get()?.values.appearance.palette, "moguri");
    await fixture.send("generated slow original terminal work");
    await waitFor(() => fixture.requests.length === 1); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/sessions"); setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().queue.some((entry) => entry.command?.name === "sessions"));
    await setup.flush(); assert.equal(setup.captureCharFrame().includes("Choose a session"), false);
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.session().queue[0]?.id, theme.id);
    await click(setup, "tui-tab-sessions"); await frameUntil(setup, "Choose a session");
    await click(setup, "tui-tab-session");
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    assert.ok(fixture.session().queue.every((entry) => entry.held));
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.service.controller.snapshot().settings.values.appearance.palette === "rose");
    await frameUntil(setup, "Choose a session");
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.filter((entry) => entry.status === "completed").length === 2);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().messages.some((entry) => entry.role === "user" && entry.text.startsWith("/")), false);
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.session().turnId, null);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("compact pending decisions keep actual environment, budget and human controls readable without granting consent", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  await reviewNativeTools(fixture, ["read_file"]); await fixture.configure();
  const setup = await createTestRenderer({ width: 52, height: 24, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await fixture.send("generated tool compact approval");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    await frameUntil(setup, "Approval required: read_file");
    await frameUntil(setup, "Env Local | Model");
    await frameUntil(setup, "Budget Unlimited");
    await frameUntil(setup, "Ctrl+D deny");
    assert.equal(fixture.session().pendingApproval?.id, approval.id);
    setup.mockInput.pressKey("d", { ctrl: true }); await fixture.terminal();
    await fixture.send("generated structured question choices only");
    const question = await waitFor(() => fixture.session().pendingQuestionId);
    await frameUntil(setup, "Your actual answer is needed");
    await frameUntil(setup, "Env Local | Model");
    await frameUntil(setup, "Budget Unlimited");
    assert.equal(fixture.session().pendingQuestionId, question);
    setup.mockInput.pressKey("F6"); await frameUntil(setup, "Actual user question");
    setup.mockInput.pressEnter(); await fixture.terminal();
    assert.equal(fixture.session().pendingQuestionId, null);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native terminal Ctrl+Enter holds yolo without selecting a model or delegating tools", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/yolo"); setup.mockInput.pressEnter({ ctrl: true });
    const queued = await waitFor(() => fixture.session().queue[0]);
    assert.equal(queued.command?.name, "yolo"); assert.equal(queued.held, true);
    assert.equal(fixture.session().controls.autonomy, "Manual"); assert.equal(fixture.session().controls.modelId, null);
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.session().controls.autonomy === "Autopilot");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().controls.modelId, null);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("queued terminal quit saves the real draft and acknowledges its actual caller without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 100, height: 38, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  let quit = 0;
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk, onQuit: () => { quit++; } }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/quit"); setup.mockInput.pressEnter();
    await waitFor(() => quit === 1);
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.some((entry) => entry.name === "quit" && entry.status === "completed"));
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.requests.length, 0);
    assert.equal(sdk.getState().status, "disconnected");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("Escape cannot be undone by a delayed command response, which remains keyboard-readable in actual history", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  class DelayedResult extends MoguriSdk {
    private delayed = false;
    override async query<Q extends PlatformQuery>(query: Q, signal?: AbortSignal): Promise<Extract<PlatformResponse, { type: Q["type"] }>> {
      const result = await super.query(query, signal);
      if (query.type === "slash.read" && !this.delayed) { this.delayed = true; entered.resolve(); await release.promise; }
      return result;
    }
  }
  const fixture = await setupFixture(), sdk = await new DelayedResult(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    await setup.mockInput.typeText("/defaults"); setup.mockInput.pressEnter();
    await entered.promise; setup.mockInput.pressKey("m", { ctrl: true }); await frameUntil(setup, "Select an available model");
    setup.mockInput.pressEscape(); await frameUntil(setup, "Write a prompt"); release.resolve();
    await frameUntil(setup, "Retained separately.");
    assert.equal(setup.renderer.root.findDescendantById(`tui-surface-${fixture.sessionId}-compose`)?.visible, true);
    await setup.mockInput.typeText("/commands"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Original queued-command results");
    assert.ok(setup.captureCharFrame().includes("/defaults / completed"));
    assert.equal(fixture.requests.length, 0);
  } finally { release.resolve(); await closeTui(root, setup, sdk, () => fixture.close()); }
});
