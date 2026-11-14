import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedKupoProfile } from "./fixtures/kupo-profiles.ts";
import { remoteWinddownApiFixture } from "./fixtures/winddown-api.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

async function frame(terminal: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 8000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 15)); await terminal.flush();
    if (terminal.captureCharFrame().includes(text)) return;
  } while (Date.now() < deadline);
  throw new Error(`The actual TUI did not render ${text}:\n${terminal.captureCharFrame()}`);
}
test("native TUI Retry uses the retained original request, not its newly typed prompt", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128,
    httpFailure: { status: 408, message: "Generated TUI upstream timeout.", remaining: 1 } });
  await fixture.configure(); await fixture.send("Generated original TUI model failure."); await fixture.terminal();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const terminal = await createTestRenderer({ width: 130, height: 48, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frame(terminal, "Model request failed");
    await terminal.mockInput.typeText("Generated TUI draft is not the retry.");
    terminal.mockInput.pressEnter();
    await waitFor(() => fixture.requests.length === 2); await fixture.terminal(); await frame(terminal, "Generated TUI draft is not the retry.");
    assert.equal(fixture.session().status, "completed");
    assert.equal(fixture.session().draft.text, "Generated TUI draft is not the retry.");
    assert.deepEqual(fixture.requests[0]!.messages, fixture.requests[1]!.messages);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});

test("native TUI reads and separately accepts exact peer checkpoint source without another model or Git approval", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const fixture = await remoteWinddownApiFixture();
  const prepare = async () => {
    try {
      assert.ok(fixture.workspace); initializeGeneratedRepository(fixture.workspace);
      const report = await fixture.run();
      await waitFor(() => {
        const executions = fixture.service.controller.snapshot().executions.filter((execution) => execution.sessionId === fixture.sessionId);
        return executions.length > 0 && executions.every((execution) => execution.cleanup === "owned-worker-stopped");
      });
      const preview = await fixture.sdk.winddown.sourcePreview(report.winddown.id, ["fixture.txt"]);
      return { report, preview };
    } catch (error) { await fixture.close(); throw error; }
  };
  const { report, preview } = await prepare();
  const terminal = await createTestRenderer({ width: 140, height: 50, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk }))); await frame(terminal, "Write a prompt");
    await terminal.mockInput.typeText(`/winddown source-preview ${report.winddown.id} ["fixture.txt"]`); terminal.mockInput.pressEnter();
    await frame(terminal, "moguri-remote-checkpoint-source"); terminal.mockInput.pressEscape(); await frame(terminal, "Write a prompt");
    await terminal.mockInput.typeText(`/winddown source-accept ${report.winddown.id} ${preview.preview.revision} ${preview.preview.digest} confirm-source ["fixture.txt"]`);
    terminal.mockInput.pressEnter(); await frame(terminal, "Only the exact peer source was accepted");
    const retained = await fixture.sdk.winddown.read(report.winddown.id);
    assert.ok(retained.winddown.version === 3 && retained.winddown.remoteAcceptance?.actor === "user");
    assert.equal(retained.winddown.commit, null); assert.equal(retained.winddown.status, "ready");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 2);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
  } catch (error) {
    console.error("Generated peer checkpoint TUI qualification failed:", error);
    throw error;
  } finally { await closeTui(root, terminal, fixture.sdk, () => fixture.close()); }
});

test("native TUI mode selection actually excludes frontier models in Savings without changing autonomy or draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  const local = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
  const frontier = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "frontier", score: 0.8, price: 5 });
  await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [local, frontier] }, fixture.sdk.settings.get()!.revision);
  await fixture.sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
  const terminal = await createTestRenderer({ width: 130, height: 48, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk }))); await frame(terminal, "Write a prompt");
    await terminal.mockInput.typeText("Generated unchanged mode task.");
    terminal.mockInput.pressKey("F11"); await frame(terminal, "Performance [unavailable]");
    terminal.mockInput.pressArrow("down"); terminal.mockInput.pressEnter();
    await waitFor(() => fixture.session().controls.kupoMode === "savings"); await frame(terminal, "Kupo routing: Savings");
    await waitFor(() => fixture.session().draft.text === "Generated unchanged mode task.");
    assert.equal(fixture.session().draft.text, "Generated unchanged mode task."); assert.equal(fixture.session().controls.autonomy, "Manual");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 0);
    terminal.mockInput.pressEnter(); await fixture.terminal();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.session().usage[0]?.totalTokens, 42);
  } finally { await closeTui(root, terminal, fixture.sdk, () => fixture.close()); }
});
