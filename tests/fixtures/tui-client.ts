import { flushSync, type createRoot } from "@opentui/react";
import type { createTestRenderer } from "@opentui/core/testing";
import type { MoguriSdk } from "../../packages/sdk/src/index.ts";

export async function waitTuiFrame(terminal: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    await terminal.flush();
    if (terminal.captureCharFrame().includes(text)) return;
  }
  throw new Error(`The generated TUI did not display ${JSON.stringify(text)} before the deadline.`);
}

export async function closeTui(root: ReturnType<typeof createRoot>, terminal: Awaited<ReturnType<typeof createTestRenderer>>, sdk: MoguriSdk, close: () => Promise<unknown>) {
  try {
    flushSync(() => root.unmount());
    await sdk.commands.detachAll();
  } finally {
    sdk.disconnect();
    try { await terminal.dispose(); } finally { await close(); }
  }
}
