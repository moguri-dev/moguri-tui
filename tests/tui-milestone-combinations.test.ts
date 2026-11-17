import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { KUPO_MODEL_ID } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, waitFor } from "./fixture.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedDocx } from "./fixtures/documents.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { configureMilestoneRouting, milestoneCellId, milestoneCalls, milestoneClientCells, milestoneResponses } from "./fixtures/milestone-combinations.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeMilestoneFixture } from "./fixtures/native-milestone-api.ts";

const native = await nativeConfiguration(true);
for (const cell of milestoneClientCells()) {
const { env, selection } = cell;
test(`actual TUI ${env}/${selection} applies exact controls and a warned combined cap, then approves only selected document access`, {
  skip: process.platform !== "darwin" || env === "Sandbox" && !native, timeout: 45000,
}, async () => {
  const fixture = env === "Sandbox" ? await nativeMilestoneFixture(native!) :
    await routedFixture({ env, legacy: false, configured: false, reasoningRoles: true, imageInput: true, toolInput: true });
  let terminal: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    await configureMilestoneRouting(fixture, selection);
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env,
      modelId: selection === "fixed" ? fixture.solverId : KUPO_MODEL_ID });
    await reviewNativeTools(fixture, ["read_document"]);
    const path = join(fixture.directory, "generated-tui-matrix.docx");
    await writeFile(path, generatedDocx());
    const document = await fixture.sdk.attachments.document(fixture.sessionId, path);
    const observed = milestoneResponses(fixture, cell, document.id!);
    const ui = terminal = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, exitOnCtrlC: false });
    const rendered = root = createRoot(ui.renderer);
    const frame = async (text: string) => {
      const deadline = Date.now() + 8000;
      do {
        await ui.flush();
        if (ui.captureCharFrame().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
      } while (Date.now() < deadline);
      throw new Error(`Required TUI matrix frame missing ${text}:\n${ui.captureCharFrame()}`);
    };
    flushSync(() => rendered.render(createElement(TuiApp, { client: fixture.sdk })));
    await frame("Write a prompt");
    for (const [command, acknowledgement] of [
      ["/context-window half", "Context window set to 16,384"],
      ...selection === "fixed" ? [["/thinking high", "Thinking effort set to high"] as const] : [],
      ["/budget set 1000000 10 confirm-estimates", "Session estimate-based cap saved."],
    ] as const) {
      await ui.mockInput.typeText(command);
      ui.mockInput.pressEnter();
      await frame(acknowledgement);
    }
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 16384, ...(selection === "fixed" ? { thinkingEffort: "high" } : {}) });
    assert.equal(observed.length, 0);
    await ui.mockInput.typeText(`Generated actual TUI matrix document question. ${milestoneCellId(cell)}`);
    ui.mockInput.pressEnter({ ctrl: true, shift: true });
    const approval = await waitFor(() => fixture.session().pendingApproval, 20000);
    assert.equal(approval.call.name, "read_document");
    await frame("Approval required: read_document");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    ui.mockInput.pressKey("y", { ctrl: true });
    await waitFor(() => !fixture.session().turnId && ["completed", "failed", "partial"].includes(fixture.session().status), 20000);
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    await frame("Generated selected milestone response.");
    const calls = await milestoneCalls(fixture, observed);
    assert.ok(calls.length > 0);
    if (selection === "fixed") assert.ok(calls.every((call) => call.request.reasoning_effort === "high"));
    else assert.equal(fixture.session().controls.modelOptions?.thinkingEffort, undefined);
    const events = fixture.service.controller.events(0);
    assert.equal(events.filter((event) => event.event_type === "tool.decided" && event.payload.actor === "user").length, 1);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.knownReportedTokens, calls.length * 42);
    assert.equal(fixture.session().controls.env, env);
  } finally {
    if (root && terminal) await closeTui(root, terminal, fixture.sdk, () => fixture.close());
    else await fixture.close();
  }
});
}
