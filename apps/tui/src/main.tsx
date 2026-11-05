/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { connectMoguri } from "../../../packages/sdk/src/node.ts";
import type { MoguriSdk } from "../../../packages/sdk/src/index.ts";
import { TuiApp } from "./App.tsx";
import { nativeActions } from "./native.ts";

const { values } = parseArgs({ options: { project: { type: "string" }, profile: { type: "string" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("Moguri TUI\n\nnpm start -- [--project /path/to/project] [--profile ID]\n\nEnter sends; Shift+Enter inserts a newline. Cmd/Ctrl+Enter holds; Shift+Cmd/Ctrl+Enter sends now.\nClick the chat, session, work, code or automation tabs. Tab focuses navigation;\nLeft closes and Right opens the sidebar there, never while editing the prompt.\nF2 or /details inspects full retained messages and tool output. PgUp/PgDn scroll history;\nF3 or click latest resumes following new output. These controls never send the draft.\n/help lists commands; Tab or click completes without executing.\n/connect signs in, /open PATH opens a project, /models selects a model,\n/profiles switches profiles, /theme lists shared palettes, /quit saves and leaves.\nSlash text joins the service queue. Only unheld /stop, /approve and /yolo are live.\nService-capable commands can finish after this client closes; UI-only actions need an actual compatible view.\nThe desktop and TUI share the same private local service.");
} else {
  let client: MoguriSdk | undefined;
  try {
    client = await connectMoguri({ profileId: values.profile ?? process.env.MOGURI_PROFILE_ID });
    let initialSessionId: string | undefined;
    if (values.project) {
      const deadline = Date.now() + 5000;
      while (client.getState().status !== "connected" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      const project = await client.command({ type: "project.add", path: resolve(values.project) });
      const existing = client.getState().snapshot?.sessions.find((session) => session.projectId === project.id && session.status !== "archived");
      initialSessionId = existing?.id ?? (await client.command({ type: "session.create", projectId: project.id! })).id;
    }
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
    createRoot(renderer).render(createElement(TuiApp, { client, initialSessionId, native: nativeActions }));
  } catch (error) {
    client?.disconnect();
    console.error(error instanceof Error ? error.message : "Moguri TUI could not start.");
    process.exitCode = 1;
  }
}
