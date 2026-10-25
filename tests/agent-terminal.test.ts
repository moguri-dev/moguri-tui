import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { MoguriSdk, PROTOCOL_VERSION, isRecord } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { effectiveTools } from "../apps/service/src/tools.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

test("only a workspace-bound model receives Agent terminal tools; project-free chats do not pay for an unusable command capability", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!.values;
    assert.equal(effectiveTools(settings, false, "agent", undefined, { project: false, env: "Local" }).some((tool) => tool.name === "read_agent_terminal"), false);
    assert.equal(effectiveTools(settings, false, "agent", undefined, { project: true, env: "Local" }).some((tool) => tool.name === "read_agent_terminal"), true);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the session Agent terminal is empty without approved agent commands and never reads a private user console", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf GENERATED_PRIVATE_USER_CONSOLE; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const user = await sdk.terminal.open(fixture.sessionId);
    const activity = (await sdk.agentTerminals.list(fixture.sessionId)).activity;
    assert.deepEqual(activity.entries, []); assert.deepEqual(activity.current, []);
    assert.equal(JSON.stringify(activity).includes("GENERATED_PRIVATE_USER_CONSOLE"), false);
    assert.equal(fixture.requests.length, 0);
    await sdk.terminal.close(user.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("CLI and shared TUI commands inspect the same Agent terminal without launching another command or model", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated shared agent terminal\\n'", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const cli = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "agent-terminal", ...args, "--session", fixture.sessionId], {
    env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state"), MOGURI_PROFILE_ID: sdk.profileId },
  });
  try {
    await fixture.configure(); await fixture.send("Generated shared command."); await fixture.approve(); await fixture.terminal();
    const id = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!.id;
    assert.equal(JSON.parse((await cli(["list"])).stdout).activity.entries[0].id, id);
    assert.match(JSON.parse((await cli(["read", id, "tail"])).stdout).content.text, /Generated shared agent terminal/);
    const listed = await sdk.slash(fixture.sessionId, "/agent-terminal list", "tui");
    assert.equal(listed.kind, "text");
    if (listed.kind !== "text") throw new Error("Shared terminal list did not return text.");
    assert.equal(JSON.parse(listed.text).activity.entries[0].id, id);
    const read = await sdk.slash(fixture.sessionId, `/agent-terminal read ${id} 0`, "tui");
    if (read.kind !== "text") throw new Error("Shared terminal read did not return text.");
    assert.match(JSON.parse(read.text).content.text, /Generated shared agent terminal/);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the actual model executes in its Agent terminal and rereads that exact output without seeing private console bytes", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ agentTerminalRead: true, toolCall: { name: "run_command", args: { command: "printf 'GENERATED_AGENT_OUTPUT\\n'", timeoutMs: 2000 } },
    platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_PRIVATE_USER_CONSOLE\\n'; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const user = await sdk.terminal.open(fixture.sessionId);
    let userOutput = "";
    for (let attempt = 0; attempt < 80 && !userOutput.includes("GENERATED_PRIVATE_USER_CONSOLE"); attempt++) {
      userOutput = (await sdk.terminal.read(user.id!)).data;
      if (!userOutput.includes("GENERATED_PRIVATE_USER_CONSOLE")) await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.match(userOutput, /GENERATED_PRIVATE_USER_CONSOLE/);
    await fixture.configure(); await fixture.send("Generated agent terminal execution and reread.");
    await waitFor(() => fixture.requests[0]);
    const declared = fixture.requests[0]!.tools;
    assert.ok(Array.isArray(declared) && declared.some((tool) => isRecord(tool) && isRecord(tool.function) && tool.function.name === "read_agent_terminal"), "The owning solver must receive the agent-terminal read capability.");
    await fixture.approve(); await fixture.approve(); await fixture.approve(); await fixture.terminal();
    const completed = fixture.service.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_agent_terminal");
    assert.equal(completed.length, 2);
    const read = completed.at(-1)!;
    if (read.event_type !== "tool.completed") throw new Error("Generated reader result missing.");
    const result = JSON.parse(read.payload.text);
    assert.equal(result.type, "agent-terminal.read"); assert.match(result.output, /GENERATED_AGENT_OUTPUT/); assert.equal(result.status, "completed");
    const requests = JSON.stringify(fixture.requests);
    assert.match(requests, /GENERATED_AGENT_OUTPUT/);
    assert.equal(requests.includes("GENERATED_PRIVATE_USER_CONSOLE"), false);
    assert.equal(fixture.requests.length, 4);
    assert.equal((await sdk.agentTerminals.list(fixture.sessionId)).activity.entries.length, 1);
    await sdk.terminal.close(user.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the Agent terminal exposes exact approved command results, not other tools, sessions or user-console IDs", { skip: process.platform !== "darwin" }, async () => {
  const options: GeneratedProviderOptions = { toolCall: { name: "run_command", args: { command: "printf 'Generated agent command output\\n'", timeoutMs: 2000 } } };
  const fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated agent command."); await fixture.approve(); await fixture.terminal();
    const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
    assert.equal(command.toolName, "run_command"); assert.equal(command.env, "Local"); assert.equal(command.status, "completed");
    const result = (await sdk.agentTerminals.read(fixture.sessionId, command.id)).content!;
    assert.match(result.text, /Generated agent command output/);
    assert.equal(result.bytes, command.outputBytes);
    const page = (await sdk.agentTerminals.read(fixture.sessionId, command.id, { limit: 8 })).content!;
    assert.equal(Buffer.byteLength(page.text), 8); assert.equal(page.nextOffset, 8);
    const user = await sdk.terminal.open(fixture.sessionId);
    await assert.rejects(() => sdk.agentTerminals.read(fixture.sessionId, user.id!), { code: "activity_missing" });
    await sdk.terminal.close(user.id!);
    delete options.toolCall;
    await fixture.send("generated tool: read the fixture"); await fixture.approve(); await fixture.terminal();
    const file = (await sdk.activity.list(fixture.sessionId)).activity.entries.find((entry) => entry.toolName === "read_file")!;
    await assert.rejects(() => sdk.agentTerminals.read(fixture.sessionId, file.id), { code: "activity_missing" });
    assert.equal((await sdk.agentTerminals.list(fixture.sessionId)).activity.entries.length, 1);
    const other = (await sdk.sessions.create(null)).id!;
    await assert.rejects(() => sdk.agentTerminals.read(other, command.id), { code: "activity_missing" });
    await sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision);
    await assert.rejects(() => sdk.agentTerminals.read(fixture.sessionId, command.id), { code: "activity_scope" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Agent output can follow a bounded UTF-8 tail without splitting characters or silently mixing paging modes", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: {
    command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write("Generated command\\n"+"🐈".repeat(5000))'`, timeoutMs: 2000,
  } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated bounded tail."); await fixture.approve(); await fixture.terminal();
    const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
    const tail = (await sdk.agentTerminals.read(fixture.sessionId, command.id, { tail: true, limit: 17 })).content!;
    assert.ok(tail.offset > 0); assert.equal(tail.nextOffset, null); assert.ok(Buffer.byteLength(tail.text) <= 17);
    assert.equal(tail.text.includes("\uFFFD"), false); assert.match(tail.text, /\[exit=0\]$/);
    await assert.rejects(() => sdk.agentTerminals.read(fixture.sessionId, command.id, { tail: true, offset: 0 }), /tail|paging|offset/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("desktop schema-45 command history converges without changing ciphertext or replaying its command after restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated retained agent output\\n'", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated retained command."); await fixture.approve(); await fixture.terminal();
    const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
    const original = (await sdk.agentTerminals.read(fixture.sessionId, command.id)).content!.text;
    const rows = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 45, "desktop");
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), rows);
    store.close(); store = undefined;
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await peer.agentTerminals.read(fixture.sessionId, command.id)).content?.text, original);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); store?.close(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("Agent reads obey explicit denial and remain read-only without granting another command", { skip: process.platform !== "darwin" }, async (t) => {
  for (const mode of ["denied", "read-only"] as const) await t.test(mode, async (t) => {
    const options: GeneratedProviderOptions = { toolCall: { name: "run_command", args: { command: "printf 'Generated policy-bound agent output\\n'", timeoutMs: 2000 } } };
    const fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await fixture.configure(); await fixture.send("Generated original policy command."); await fixture.approve(); await fixture.terminal();
      const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
      options.toolCall = { name: "read_agent_terminal", args: { action: "read", commandId: command.id } };
      const read = t.mock.method(fixture.service.controller.platform.activity, "agentTerminal");
      if (mode === "denied") {
        const settings = sdk.settings.get()!;
        await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [
          ...settings.values.permissions.tools, { id: "generated-agent-read-denial", tool: "read_agent_terminal", pathPrefix: "", decision: "deny" },
        ] } }, settings.revision);
      } else await sdk.slash(fixture.sessionId, "/read-only", "tui");
      await fixture.send("Generated permission-bound reread.");
      if (mode === "read-only") await fixture.approve();
      await fixture.terminal();
      const result = fixture.service.controller.events(0).findLast((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_agent_terminal")!;
      if (result.event_type !== "tool.completed") throw new Error("Generated policy result missing.");
      assert.equal(result.payload.outcome, mode === "denied" ? "denied" : "completed");
      assert.equal(read.mock.callCount(), mode === "denied" ? 0 : 1);
      assert.equal((await sdk.agentTerminals.list(fixture.sessionId)).activity.entries.length, 1);
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("policy revocation or stop during an Agent read cannot publish held output or start another model after cancellation", { skip: process.platform !== "darwin" }, async (t) => {
  for (const change of ["policy", "stop"] as const) await t.test(change, async (t) => {
    const options: GeneratedProviderOptions = { toolCall: { name: "run_command", args: { command: "printf 'GENERATED_HELD_AGENT_SOURCE\\n'", timeoutMs: 2000 } } };
    const fixture = await setupFixture(options), sdk = await new MoguriSdk(fixture.service.connection).ready();
    let enter = () => {}, release = () => {};
    const entered = new Promise<void>((resolve) => { enter = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
    try {
      await fixture.configure(); await fixture.send("Generated original held source."); await fixture.approve(); await fixture.terminal();
      const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
      options.toolCall = { name: "read_agent_terminal", args: { action: "read", commandId: command.id } };
      const original = fixture.service.controller.platform.activity.agentTerminal.bind(fixture.service.controller.platform.activity);
      t.mock.method(fixture.service.controller.platform.activity, "agentTerminal", async (...args: Parameters<typeof original>) => {
        const result = await original(...args); enter(); await held; return result;
      });
      await fixture.send("Generated read with changing authority."); await fixture.approve(); await entered;
      const turnId = fixture.session().turnId;
      if (change === "policy") {
        const settings = sdk.settings.get()!;
        await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [
          ...settings.values.permissions.tools, { id: "generated-late-agent-denial", tool: "read_agent_terminal", pathPrefix: "", decision: "deny" },
        ] } }, settings.revision);
        release();
      } else {
        const stopped = sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
        await waitFor(() => fixture.service.controller.events(0).some((event) => event.event_type === "turn.stop_requested" && event.turn_id === turnId));
        release(); await stopped;
      }
      await fixture.terminal();
      const result = fixture.service.controller.events(0).findLast((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_agent_terminal");
      assert.ok(result?.event_type === "tool.completed");
      if (result.event_type !== "tool.completed") throw new Error("Generated held result missing.");
      assert.notEqual(result.payload.outcome, "completed"); assert.equal(result.payload.text.includes("GENERATED_HELD_AGENT_SOURCE"), false);
      if (change === "stop") { assert.notEqual(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 3); }
      assert.equal((await sdk.agentTerminals.list(fixture.sessionId)).activity.entries.length, 1);
    } finally { release(); sdk.disconnect(); await fixture.close(); }
  });
});

test("stopping an actual Agent command retains its partial output without closing the separate private User console", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf GENERATED_PRIVATE_CONSOLE_READY; exec cat"] } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const user = await sdk.terminal.open(fixture.sessionId);
    await fixture.configure(); await fixture.send("generated command"); await fixture.approve(); await waitFor(() => fixture.session().processes.length);
    const running = (await sdk.agentTerminals.list(fixture.sessionId)).activity;
    assert.equal(running.currentCount, 1);
    assert.equal((await sdk.agentTerminals.read(fixture.sessionId, running.current[0]!.id, { tail: true })).entry.outputBasis, "retained-tail");
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const stopped = (await sdk.agentTerminals.list(fixture.sessionId)).activity;
    assert.equal(stopped.currentCount, 0); assert.notEqual(stopped.entries[0]!.status, "completed");
    assert.equal((await sdk.terminal.read(user.id!)).terminal.status, "running");
    assert.equal(fixture.requests.length, 1);
    await sdk.terminal.close(user.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the actual pinned SSH worker runs and rereads its Agent command without a Local execution fallback", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const fixture = await remoteFixture({ agentTerminalRead: true, toolCall: { name: "run_command", args: { command: "printf 'GENERATED_REMOTE_AGENT\\n'; pwd", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe(); await fixture.select(); await fixture.send("Generated Remote agent terminal.");
    await fixture.approve(); await fixture.approve(); await fixture.approve(); await fixture.terminal();
    const command = (await sdk.agentTerminals.list(fixture.sessionId)).activity.entries[0]!;
    assert.equal(command.env, "Remote"); assert.equal(command.status, "completed");
    const output = (await sdk.agentTerminals.read(fixture.sessionId, command.id)).content!.text;
    assert.match(output, /GENERATED_REMOTE_AGENT/); assert.ok(output.includes(fixture.workspace));
    assert.equal(output.includes(fixture.project), false);
    const reread = fixture.service.controller.events(0).findLast((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_agent_terminal");
    assert.ok(reread?.event_type === "tool.completed");
    if (reread.event_type !== "tool.completed") throw new Error("Generated Remote reread missing.");
    assert.equal(JSON.parse(reread.payload.text).env, "Remote");
    assert.equal(fixture.requests.length, 4);
  } finally { sdk.disconnect(); await fixture.close(); }
});
