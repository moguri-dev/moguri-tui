import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createElement } from "react";
import test from "node:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk } from "@moguri-dev/sdk";
import { closeTui } from "./fixtures/tui-client.ts";
import { cloneRepositoryFixture } from "./fixtures/clone-repository.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("the built CLI previews/imports an exact list and reviews/changes the resulting real repository remote", async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  const cli = async (args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "project", ...args, "--json"], {
    env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") }, encoding: "utf8", timeout: 15_000,
  })).stdout);
  try {
    const input = join(f.directory, "generated-list.txt"); await writeFile(input, `- ${source.repository}\n`);
    const { preview } = await cli(["import-preview", input, "--root", f.directory]);
    assert.equal(preview.document.entries[0].disposition, "clone"); assert.equal(source.requests(), 0);
    const started = await cli(["import", input, "--root", f.directory, "--digest", preview.digest, "--confirm-review"]);
    const { batch } = await sdk.projects.imports.wait(started.batch.id);
    assert.equal(batch.status, "completed"); assert.equal((await cli(["imports"]))[0].id, batch.id);
    const remote = (await cli(["remote-preview", batch.items[0]!.projectId!, "origin", "git@github.com:generated-cli-moved/project.git"])).preview;
    const changed = await cli(["remote-set", batch.items[0]!.projectId!, "origin", remote.document.action.url, "--digest", remote.digest,
      "--confirmations", JSON.stringify(remote.document.confirmations), "--confirm-write"]);
    assert.equal((await sdk.github.wait(changed.id)).operation.status, "completed");
    assert.equal((await sdk.projects.git(batch.items[0]!.projectId!)).repository, "https://github.com/generated-cli-moved/project");
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); await source.close(); }
});

test("native TUI intake reviews a URL list and starts only the exact confirmed shared import, without invoking a model", { skip: process.platform !== "darwin" }, async () => {
  const source = await cloneRepositoryFixture(), f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  const terminal = await createTestRenderer({ width: 140, height: 45, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(terminal.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await waitFor(() => sdk.getState().status === "connected"); await terminal.flush();
    const input = { text: source.repository, parent: f.directory };
    await terminal.mockInput.typeText(`/repositories preview ${JSON.stringify(input)}`); terminal.mockInput.pressEnter();
    const execution = await waitFor(() => f.service.controller.snapshot().commandExecutions.find((entry) => entry.name === "repositories" && entry.status === "completed"));
    const result = await sdk.query({ type: "slash.read", executionId: execution.id });
    assert.equal(result.result?.kind, "text");
    if (result.result?.kind !== "text") throw new Error("Generated TUI did not retain the actual complete preview.");
    const { preview } = JSON.parse(result.result.text); assert.equal(source.requests(), 0);
    await terminal.flush();
    await terminal.mockInput.typeText(`/repositories import ${preview.digest} confirm-reviewed ${JSON.stringify(input)}`); terminal.mockInput.pressEnter();
    const batch = await waitFor(() => f.service.controller.snapshot().repositoryImports[0]);
    assert.equal((await sdk.projects.imports.wait(batch.id)).batch.status, "completed");
    await terminal.flush();
    assert.equal(f.service.controller.snapshot().commandExecutions.filter((entry) => entry.name === "repositories").length, 2);
    assert.equal(f.requests.length, 0); assert.equal(f.session().projectId, f.service.controller.snapshot().projects[0]?.id);
    const imported = (await sdk.projects.imports.read(batch.id)).batch.items[0]!, session = await sdk.sessions.create(imported.projectId!);
    const workspaceId = sdk.sessions.get(session.id!)?.workspaceId;
    assert.ok(workspaceId); assert.equal((await sdk.workspaces.wait(workspaceId)).status, "ready");
    const remote = await sdk.slash(session.id!, '/git remote-preview {"remote":"origin","url":"git@github.com:generated-tui-moved/project.git"}', "tui");
    assert.equal(remote.kind, "text");
    if (remote.kind !== "text") throw new Error("Generated TUI remote review did not return its original source.");
    const review = JSON.parse(remote.text).preview;
    const changed = await sdk.slash(session.id!, `/git remote-set confirm-write ${JSON.stringify({
      action: review.document.action, expectedDigest: review.digest, confirmations: review.document.confirmations,
    })}`, "tui");
    assert.equal(changed.kind, "text");
    if (changed.kind !== "text") throw new Error("Generated TUI remote action did not return its retained identity.");
    assert.equal((await sdk.github.wait(JSON.parse(changed.text).id)).operation.status, "completed");
    assert.equal((await sdk.projects.git(imported.projectId!)).repository, "https://github.com/generated-tui-moved/project");
    assert.equal(f.requests.length, 0);
  } finally { await closeTui(root, terminal, sdk, () => f.close()); await source.close(); }
});
