import { flushSync, type createRoot } from "@opentui/react";
import type { createTestRenderer } from "@opentui/core/testing";
import type { MoguriSdk } from "../../packages/sdk/src/index.ts";

export async function closeTui(root: ReturnType<typeof createRoot>, terminal: Awaited<ReturnType<typeof createTestRenderer>>, sdk: MoguriSdk, close: () => Promise<unknown>) {
  try {
    flushSync(() => root.unmount());
    await sdk.commands.detachAll();
  } finally {
    sdk.disconnect();
    try { await terminal.dispose(); } finally { await close(); }
  }
}
