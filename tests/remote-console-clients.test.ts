import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

test("compiled CLI and shared TUI commands explicitly open, inspect and stop the captured Remote console without storing stdin", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteFixture({ exposeModels: false, platform: { terminal: { executable: "/bin/sh", args: ["-c", "stty -echo; printf 'GENERATED_REMOTE_CLI_READY\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(f.service.connection).ready(), executable = resolve("dist/cli.mjs"), env = { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") };
  const cli = (args: string[]) => promisify(execFile)(process.execPath, [executable, "terminal", ...args], { env });
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const opened = JSON.parse((await cli(["open", "--session", f.sessionId])).stdout);
    const input = spawn(process.execPath, [executable, "terminal", "input", opened.id], { env, stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<number | null>((resolve, reject) => { input.once("error", reject); input.once("exit", resolve); });
    let stdout = "", stderr = ""; input.stdout.on("data", (data) => { stdout += data; }); input.stderr.on("data", (data) => { stderr += data; });
    input.stdin.end("GENERATED_REMOTE_CLI_STDIN\n"); assert.equal(await exited, 0, stderr); assert.equal(JSON.parse(stdout).acknowledged, true);
    for (let index = 0; index < 100; index++) { if ((await sdk.terminal.read(opened.id)).data.includes("GENERATED_REMOTE_CLI_STDIN")) break; await new Promise((resolve) => setTimeout(resolve, 15)); }
    const read = JSON.parse((await cli(["read", opened.id])).stdout);
    assert.equal(read.terminal.env, "Remote"); assert.equal(read.terminal.binding.root, f.workspace); assert.match(read.data, /GENERATED_REMOTE_CLI_STDIN/);
    const listed = await sdk.slash(f.sessionId, "/terminals list", "tui");
    assert.ok(listed.kind === "text" && JSON.parse(listed.text).terminals[0].id === opened.id);
    const second = await sdk.slash(f.sessionId, "/terminals open", "tui");
    assert.ok(second.kind === "text");
    const created = JSON.parse(second.text).terminal; assert.equal(created.env, "Remote"); assert.notEqual(created.pid, read.terminal.pid);
    await sdk.slash(f.sessionId, `/terminals close ${created.id}`, "tui");
    await cli(["close", opened.id]);
    assert.equal(f.controller.snapshot().terminals.filter((terminal) => terminal.status === "closed").length, 2);
    assert.equal(JSON.stringify(f.controller.events(0)).includes("GENERATED_REMOTE_CLI_STDIN"), false); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
