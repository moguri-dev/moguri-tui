import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { KUPO_MODEL_ID, MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual TUI keeps Kupo's exact window and rejects manual thinking without inference", {
  skip: process.platform !== "darwin", timeout: 20_000,
}, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768, maxOutputTokens: 512, responseMode: "text" });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
  const terminal = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(terminal.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + ciTime(8000);
    do {
      await new Promise((resolve) => setTimeout(resolve, 15));
      await terminal.flush();
      if (terminal.captureCharFrame().includes(text)) return;
    } while (Date.now() < deadline);
    throw new Error(`TUI pooled controls did not acknowledge ${text}:\n${terminal.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil("Write a prompt");
    for (const [command, acknowledgement] of [
      ["/context-window 24577", "Context window set to 24,577"],
      ["/thinking high", "chosen automatically"],
    ] as const) {
      await terminal.mockInput.typeText(command);
      terminal.mockInput.pressEnter();
      await frameUntil(acknowledgement);
    }
    assert.equal(fixture.session().controls.modelId, KUPO_MODEL_ID);
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 24577 });
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});
