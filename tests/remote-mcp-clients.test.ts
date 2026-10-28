import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

test("CLI and shared TUI/desktop commands review exact Remote grants with no model, credential forwarding or implicit approval", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "mcp", ...args, "--session", f.sessionId],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const preview = JSON.parse((await execute(["remote-preview", "builtin"])).stdout).preview;
    assert.equal(preview.host.port, f.ssh.target.port); assert.equal(preview.root, f.workspace); assert.equal(preview.granted, false);
    await assert.rejects(() => execute(["remote-grant", "builtin", "--digest", preview.digest, "--revision", String(preview.settingsRevision)]), /confirm-review/);
    await assert.rejects(() => sdk.slash(f.sessionId, `/mcp-remote grant builtin ${preview.digest} ${preview.settingsRevision}`, "tui"), { code: "remote_mcp_command" });
    await execute(["remote-grant", "builtin", "--digest", preview.digest, "--revision", String(preview.settingsRevision), "--confirm-review"]);
    await f.probe(); await sdk.refresh();
    assert.equal(JSON.parse((await execute(["servers"])).stdout).servers[0].state, "configured");
    const tools = JSON.parse((await execute(["tools", "builtin", "grep"])).stdout).tools;
    const pending = await sdk.mcp.call(f.sessionId, "builtin", "grep_logs", { path: "fixture.txt", query: "remote source" }, tools[0].digest);
    assert.equal((await sdk.jobs.wait(pending.id!)).status, "completed");
    assert.equal(f.session().pendingApproval, null);
    const calls = JSON.parse((await execute(["remote-calls"])).stdout).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0].actor, "external");
    for (const client of ["tui", "desktop"] as const) {
      const listed = await sdk.slash(f.sessionId, "/mcp-remote calls", client);
      assert.ok(listed.kind === "text" && JSON.parse(listed.text).calls[0].id === calls[0].id);
      const inspected = await sdk.slash(f.sessionId, `/mcp-remote inspect ${calls[0].id}`, client);
      assert.ok(inspected.kind === "text" && inspected.text.includes("generated actual remote source"));
    }
    assert.match((await execute(["remote-call", calls[0].id])).stdout, /generated actual remote source/);
    const revoked = await sdk.slash(f.sessionId, `/mcp-remote revoke builtin ${sdk.settings.get()!.revision} confirm-revoke`, "tui");
    assert.equal(revoked.kind, "ok"); await f.probe(); await sdk.refresh();
    const current = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    assert.equal(current.granted, false);
    await sdk.slash(f.sessionId, `/mcp-remote grant builtin ${current.digest} ${current.settingsRevision} confirm-reviewed`, "desktop");
    await sdk.refresh();
    await execute(["remote-revoke", "builtin", "--revision", String(sdk.settings.get()!.revision), "--confirm-review"]);
    assert.deepEqual(f.controller.snapshot().settings.values.remote!.mcpGrants, []);
    assert.equal(f.controller.snapshot().remoteMcpCalls.length, 1); assert.equal(f.controller.snapshot().executions.length, 1);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
