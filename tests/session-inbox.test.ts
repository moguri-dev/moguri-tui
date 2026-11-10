import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AttentionDeletedSchema, MoguriSdk, parse, projectEvents } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("deleting an Inbox notification is shared and durable, never an answer, approval, cancellation or budget release", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("generated structured question choices only");
    const questionId = await waitFor(() => f.session().pendingQuestionId);
    const attention = await waitFor(() => sdk.getState().snapshot?.attention.find((entry) => entry.messageId === questionId && entry.active));
    const turnId = f.session().turnId, requests = f.requests.length, budget = structuredClone(f.service.controller.snapshot().budgetEntries);
    await sdk.attention.delete([attention.id]); await peer.refresh();
    assert.equal(peer.attention.list().some((entry) => entry.id === attention.id), false);
    assert.equal(f.service.controller.snapshot().attention.find((entry) => entry.id === attention.id)?.deleted, true);
    assert.equal(f.session().pendingQuestionId, questionId); assert.equal(f.session().turnId, turnId);
    assert.equal(f.service.controller.snapshot().questions.find((question) => question.id === questionId)?.answer, null);
    assert.equal(f.session().pendingApproval, null); assert.equal(f.requests.length, requests);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries, budget);
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "attention.deleted").length, 1);
    const history = f.service.controller.events(0), original = history.find((event) => event.event_type === "attention.raised" && event.payload.attention.id === attention.id)!;
    assert.throws(() => projectEvents([...history, { ...original, id: crypto.randomUUID(), seq: history.at(-1)!.seq + 1 }]), /deleted|replayed/i);
    assert.throws(() => parse(AttentionDeletedSchema, { attentionIds: [attention.id], actor: "model" }));
    await assert.rejects(() => peer.attention.acknowledge([attention.id]), { code: "attention_missing" });
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    await f.terminal();
  } finally { peer.disconnect(); sdk.disconnect(); await f.close(); }
});

test("the compiled CLI and shared TUI Inbox commands use the same exact deletion without a model or session mutation", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  const execute = promisify(execFile);
  const cli = async (...args: string[]) => JSON.parse((await execute(process.execPath, ["dist/cli.mjs", "inbox", ...args, "--session", f.sessionId, "--json"],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") }, timeout: 15000, encoding: "utf8" })).stdout);
  try {
    await f.configure(); await f.send("Generated shared Inbox command."); await f.terminal();
    const notice = (await cli("list"))[0];
    const shared = await sdk.slash(f.sessionId, "/inbox", "tui");
    assert.equal(shared.kind, "text"); assert.ok(shared.kind === "text" && shared.text.includes(notice.id));
    const calls = f.requests.length, budget = structuredClone(f.service.controller.snapshot().budgetEntries);
    await cli("delete", notice.id); await sdk.refresh();
    assert.deepEqual(await cli("list"), []); assert.deepEqual(sdk.attention.list(), []);
    assert.equal(f.session().status, "completed"); assert.deepEqual(f.service.controller.snapshot().budgetEntries, budget); assert.equal(f.requests.length, calls);
    await f.send("Generated second shared Inbox command."); await f.terminal(); await sdk.refresh();
    const next = sdk.attention.list()[0]!;
    const deleted = await sdk.slash(f.sessionId, `/inbox delete ${next.id}`, "tui");
    assert.equal(deleted.kind, "ok"); assert.deepEqual(sdk.attention.list(), []);
  } finally { sdk.disconnect(); await f.close(); }
});

test("competing Inbox deletions commit once and a stale mixed ID set removes nothing", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready(), peer = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated Inbox completion."); await f.terminal(); await sdk.refresh();
    const attention = sdk.attention.list()[0]!, requests = f.requests.length;
    await assert.rejects(() => sdk.attention.delete([attention.id, crypto.randomUUID()]), { code: "attention_missing" });
    assert.equal(sdk.attention.list()[0]?.id, attention.id);
    const results = await Promise.allSettled([sdk.attention.delete([attention.id]), peer.attention.delete([attention.id])]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "attention.deleted").length, 1);
    assert.equal(f.requests.length, requests); assert.equal(f.session().status, "completed");
    sdk.disconnect(); peer.disconnect(); await f.service.close();
    const restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey,
      platform: { terminal: { defaultRoot: f.home } } });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal(current.attention.list().some((entry) => entry.id === attention.id), false);
      assert.equal(restarted.controller.snapshot().attention.find((entry) => entry.id === attention.id)?.deleted, true);
      assert.equal(f.requests.length, requests);
    } finally { current.disconnect(); await restarted.close(); }
  } finally { peer.disconnect(); sdk.disconnect(); await f.close(); }
});

test("Inbox deletion is profile-owned and removing its real session removes the notification and witness", async () => {
  const f = await profileFixture();
  try {
    const created = await f.sdk.sessions.create(null, "Generated Inbox owner"), id = crypto.randomUUID();
    f.service.store.commit([{ event_type: "attention.raised", profile_id: f.sdk.profileId, session_id: created.id!, payload: {
      attention: { id, sessionId: created.id!, projectId: null, kind: "done", reason: "completed", source: "state",
        messageId: null, acknowledged: false, active: true, createdAt: new Date().toISOString() },
    } }]);
    f.service.controller.refreshProfile(); await f.sdk.refresh();
    const beta = await f.create("Generated Inbox other profile");
    assert.equal(beta.client.attention.list().length, 0);
    await assert.rejects(() => beta.client.attention.delete([id]), { code: "attention_missing" });
    assert.equal(f.sdk.attention.list()[0]?.id, id);
    const session = f.sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
    await f.sdk.sessions.delete(session.id, true, session.revision);
    assert.equal(f.service.controller.snapshot().attention.some((entry) => entry.sessionId === session.id), false);
    assert.equal(f.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await f.close(); }
});
