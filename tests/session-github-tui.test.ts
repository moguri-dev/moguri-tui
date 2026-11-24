import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { Renderable, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { isRecord, MoguriSdk } from "@moguri-dev/sdk";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { ciTime } from "./fixtures/time-scale.ts";

async function frameUntil(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + ciTime(8000);
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush();
    if (setup.captureCharFrame().includes(text)) return;
  } while (Date.now() < deadline);
  throw new Error(`Native workflow did not render ${text}:\n${setup.captureCharFrame()}`);
}

test("native TUI searches the exact private repository without model work or an inferred account", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const fixture = await githubApplicationFixture(), setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frameUntil(setup, "Write a prompt"); await setup.mockInput.typeText("/github search is:issue is:open (UI OR UX OR redesign OR polish)"); setup.mockInput.pressEnter();
    await frameUntil(setup, "Generated issue");
    assert.equal(fixture.calls.filter((call) => call.path.startsWith("search/issues?")).length, 1);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)?.turnId, null);
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { await closeTui(root, setup, fixture.sdk, () => fixture.close()); }
});

test("native TUI previews the exact uniquely linked PR CI watch without starting inference or polling", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const fixture = await githubApplicationFixture(), setup = await createTestRenderer({ width: 160, height: 75, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    const project = await fixture.sdk.github.project(fixture.scope);
    const source = await fixture.sdk.github.source(fixture.scope, { kind: "pull", number: 11, repository: project.repository, account: project.account, accountId: project.accountId });
    await fixture.sdk.sessions.associatePr(fixture.sessionId, { ...source.source, expectedDigest: source.digest });
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frameUntil(setup, "Write a prompt"); await setup.mockInput.typeText("/github ci-preview"); setup.mockInput.pressEnter();
    await frameUntil(setup, "github.ci.watch");
    const snapshot = fixture.service.controller.snapshot();
    assert.equal(snapshot.githubOperations.filter((operation) => operation.ci).length, 0);
    assert.equal(snapshot.sessions.find((session) => session.id === fixture.sessionId)?.turnId, null);
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { await closeTui(root, setup, fixture.sdk, () => fixture.close()); }
});

test("native TUI pickers discover repositories and review complete project issues before starting an idle source-bound session", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const fixture = await githubApplicationFixture(), setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frame = (text: string) => frameUntil(setup, text);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frame("Write a prompt"); await setup.mockInput.typeText("/github repos"); setup.mockInput.pressEnter();
    await frame("GitHub repositories / generated-owner");
    setup.mockInput.pressEnter(); await frame("Clone generated-owner/fixture");
    setup.mockInput.pressEscape(); await frame("Write a prompt");
    await setup.mockInput.typeText("/github issues"); setup.mockInput.pressEnter();
    await frame("generated-owner/fixture / Issues"); setup.mockInput.pressEnter();
    await frame("Generated **issue body**."); setup.mockInput.pressKey("n", { ctrl: true });
    await waitFor(() => fixture.service.controller.snapshot().sessions.length === 2);
    const session = fixture.service.controller.snapshot().sessions.at(-1)!;
    assert.equal(session.workItemUrl, "https://github.com/generated-owner/fixture/issues/7");
    assert.ok(session.draft.text.includes("Generated **issue body**.")); assert.equal(session.turnId, null);
    assert.equal(fixture.git(["branch", "--show-current"]), "generated-feature"); assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { await closeTui(root, setup, fixture.sdk, () => fixture.close()); }
});

test("the actual Code requests tab explicitly browses project PRs and reviews a complete source without writes or session creation", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const fixture = await githubApplicationFixture(), setup = await createTestRenderer({ width: 140, height: 55, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk }))); await frameUntil(setup, "Write a prompt");
    const tab = setup.renderer.root.findDescendantById("tui-tab-code-requests");
    assert.ok(tab instanceof Renderable);
    await setup.mockMouse.click(tab.x + 5, tab.y); await frameUntil(setup, "Session code requests");
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
    setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await frameUntil(setup, "generated-owner/fixture / Pull requests");
    setup.mockInput.pressEnter(); await frameUntil(setup, "Generated **pull request body**.");
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
    assert.equal(fixture.service.controller.snapshot().sessions.length, 1);
    assert.equal(fixture.service.controller.snapshot().sessions[0]?.turnId, null);
    assert.equal(fixture.service.controller.snapshot().sessions[0]?.usage.length, 0);
  } finally { await closeTui(root, setup, fixture.sdk, () => fixture.close()); }
});

test("native TUI remembered approval choices share project grants with later turns and other SDK clients", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await reviewNativeTools(fixture, ["read_file"]);
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
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native TUI continuation asks for a route each time and sends the slash literally only after the actual model choice", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await fixture.configure();
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "Write a prompt"); await setup.mockInput.typeText("/continue-work"); setup.mockInput.pressEnter();
    await frameUntil(setup, "choose for this request");
    assert.equal(fixture.requests.length, 0);
    setup.mockInput.pressEscape(); await frameUntil(setup, "Draft saved");
    await waitFor(() => fixture.session().draft.text === "/continue-work");
    assert.equal(setup.captureCharFrame().includes("choose for this request"), false);
    assert.equal(fixture.session().draft.text, "/continue-work");
    setup.mockInput.pressEnter(); await frameUntil(setup, "choose for this request");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await fixture.terminal();
    assert.equal(fixture.requests.length, 1);
    assert.ok(fixture.session().messages.some((message) => message.role === "user" && message.text === "/continue-work"));
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("native continuation cancellation waits for canonical draft restoration before allowing another Enter", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async (t) => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const gate = Promise.withResolvers<void>(); let received = false;
  const dispatch = fixture.service.controller.dispatch.bind(fixture.service.controller);
  t.mock.method(fixture.service.controller, "dispatch", async (...args: Parameters<typeof dispatch>) => {
    const request = args[0];
    if (isRecord(request) && isRecord(request.command) && request.command.type === "slash.client.complete" && request.command.restoreInput === true) {
      received = true; await gate.promise;
    }
    return dispatch(...args);
  });
  try {
    await fixture.configure(); flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "Write a prompt"); await setup.mockInput.typeText("/continue-work"); setup.mockInput.pressEnter();
    await frameUntil(setup, "choose for this request"); setup.mockInput.pressEscape(); await waitFor(() => received);
    await setup.flush(); assert.match(setup.captureCharFrame(), /Restoring the original draft/);
    setup.mockInput.pressEnter(); setup.mockInput.pressEscape();
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.service.controller.snapshot().commandExecutions.length, 1);
    gate.resolve();
    await frameUntil(setup, "Commands / Up/Down choose"); await frameUntil(setup, "Draft saved");
    const input = setup.renderer.root.findDescendantById("tui-composer");
    assert.ok(input instanceof TextareaRenderable); assert.equal(input.plainText, "/continue-work");
    setup.mockInput.pressEnter(); await frameUntil(setup, "choose for this request");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter(); await fixture.terminal();
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.service.controller.snapshot().commandExecutions.length, 2);
  } finally { gate.resolve(); t.mock.restoreAll(); await closeTui(root, setup, sdk, () => fixture.close()); }
});
