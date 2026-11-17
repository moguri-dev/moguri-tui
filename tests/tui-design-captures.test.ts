import test from "node:test";
import { createElement } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui, waitTuiFrame } from "./fixtures/tui-client.ts";

// Opt-in text captures for docs/design-audit.md. Set MOGURI_TUI_CAPTURE_DIR to an absolute directory
// and MOGURI_TUI_CAPTURE_PREFIX to "before" or "after". Generated fixtures only; no assertions on copy.
const directory = process.env.MOGURI_TUI_CAPTURE_DIR ?? "";
const prefix = process.env.MOGURI_TUI_CAPTURE_PREFIX ?? "capture";

test("captures TUI approval, state row and session list frames", { skip: process.platform !== "darwin" || !isAbsolute(directory) }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf GENERATED_DESIGN_AUDIT", timeoutMs: 2000 } } });
  await fixture.configure(); await fixture.send("Generated approval request for the design audit.");
  await waitFor(() => fixture.session().pendingApproval);
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const save = async (name: string) => {
    await setup.waitForVisualIdle(); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${prefix}-tui-${name}.txt`), setup.captureCharFrame());
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await waitTuiFrame(setup, "GENERATED_DESIGN_AUDIT");
    await save("approval-100x30");
    setup.resize(52, 24); await waitTuiFrame(setup, "Approval required");
    await save("approval-52x24");
    setup.resize(100, 30); await waitTuiFrame(setup, "Approval required");
    const tab = setup.renderer.root.findDescendantById("tui-tab-sessions");
    if (!(tab instanceof Renderable)) throw new Error("The Sessions tab is missing.");
    await setup.mockMouse.click(tab.x + 1, tab.y);
    await waitTuiFrame(setup, "Choose a session");
    await save("sessions-100x30");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});
