import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { localModelId } from "../apps/service/src/model-registry.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("compiled CLI and shared TUI commands manage one authoritative availability catalogue without inference", async () => {
  const f = await setupFixture({ exposeModels: true }), sdk = await new MoguriSdk(f.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    const catalogue = JSON.parse((await execute(["models", "catalogue"])).stdout);
    assert.equal(catalogue.models[0].apiModelId, f.modelId);
    await execute(["models", "disable", f.modelId]);
    assert.equal(JSON.parse((await execute(["models", "list"])).stdout).models.some((model: { id: string }) => model.id === f.modelId), false);
    await assert.rejects(() => execute(["slash", `/model ${f.modelId}`, "--session", f.sessionId]), /available|disabled/i);
    await assert.rejects(() => execute(["models", "enable", f.modelId, "--revision", "0"]), /changed settings|Reload/i);
    await sdk.refresh(); await sdk.slash(f.sessionId, `/models enable ${f.modelId}`, "tui");
    await execute(["models", "provider", "github-copilot", "disable"]);
    assert.equal(f.provider.state.status, "connected");
    await execute(["models", "provider", "github-copilot", "enable"]); await sdk.refresh();
    const settings = sdk.settings.get()!, local = localModelId("cli-choice", f.modelId);
    await sdk.settings.update({ ...settings.values, localModels: [{ id: "cli-choice", name: "Generated CLI source", enabled: true,
      baseUrl: `${f.baseUrl}/v1`, auth: "none", models: [{ id: f.modelId, name: "Generated duplicate CLI model", contextWindow: f.contextWindow, maxTokens: 128, imageInput: false }] }] }, settings.revision);
    await waitFor(() => sdk.models.catalogue().models[0]?.offerings.find((offering) => offering.model.id === local)?.available);
    await sdk.slash(f.sessionId, `/models source ${f.modelId} ${local}`, "tui");
    assert.deepEqual(JSON.parse((await execute(["models", "list"])).stdout).models.filter((model: { synthetic?: boolean }) => !model.synthetic).map((model: { id: string }) => model.id), [local]);
    await execute(["models", "source", f.modelId, f.modelId]); await sdk.refresh();
    const managed = await sdk.slash(f.sessionId, "/models catalogue", "tui");
    assert.ok(managed.kind === "text"); assert.equal(JSON.parse(managed.text).models[0].sourceModelId, f.modelId);
    await assert.rejects(() => sdk.slash(f.sessionId, "/models enable", "tui"), /Use \/models/);
    assert.equal(f.requests.length, 0); assert.equal(f.session().controls.modelId, null);
  } finally { sdk.disconnect(); await f.close(); }
});
