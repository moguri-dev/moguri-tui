import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { sourceRootSync } from "@moguri-dev/sdk/testing";
import { MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture, waitFor } from "./fixture.ts";
import { closeTui, waitTuiFrame } from "./fixtures/tui-client.ts";

test("the TUI asks once for an observed repository and imports it with the saved don't-ask-again preference", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const terminal = await createTestRenderer({ width: 140, height: 40, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  try {
    const repo = join(fixture.home, "generated-tui-repo");
    await mkdir(repo); execFileSync("git", ["init", "-q", repo]);
    const id = (await sdk.sessions.create(null, "Generated TUI Home chat")).id!;
    fixture.service.store.commit([{ event_type: "session.repository_observed", profile_id: sdk.profileId, session_id: id,
      payload: { root: sourceRootSync(await realpath(repo)), turnId: "generated-observing-turn" } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    flushSync(() => root.render(createElement(TuiApp, { client: sdk, initialSessionId: id })));
    await waitTuiFrame(terminal, "Import it as a project and move this chat?");
    const line = terminal.renderer.root.findDescendantById("tui-repository-proposal");
    assert.ok(line instanceof Renderable);
    await terminal.mockMouse.click(line.x + 2, line.y); await waitTuiFrame(terminal, "Import and move, don't ask again");
    terminal.mockInput.pressArrow("down"); terminal.mockInput.pressEnter();
    await waitFor(() => sdk.sessions.get(id)?.projectId);
    await waitFor(() => sdk.settings.get()?.values.interactions.confirmRepositoryImport === false);
    const project = sdk.getState().snapshot!.projects.find((value) => value.id === sdk.sessions.get(id)!.projectId)!;
    assert.equal(project.path, await realpath(repo));
    assert.equal(sdk.sessions.get(id)!.homeRoot, undefined);
    await waitTuiFrame(terminal, "moved this chat into it");
    assert.equal(terminal.captureCharFrame().includes("Import it as a project and move this chat?"), false);
  } finally { await closeTui(root, terminal, sdk, () => fixture.close()); }
});
