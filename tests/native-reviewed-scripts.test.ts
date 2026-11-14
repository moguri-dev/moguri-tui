import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeMilestoneFixture } from "./fixtures/native-milestone-api.ts";
import { waitFor } from "./fixture.ts";

const native = await nativeConfiguration(true);
type Fixture = Awaited<ReturnType<typeof nativeMilestoneFixture>>;
const stage = (f: Fixture) => {
  const value = f.service.controller.snapshot().sandboxWorkspaces?.find((workspace) => workspace.id === f.session().sandboxWorkspaceId)?.stage?.workspace;
  assert.ok(value); return value;
};
async function send(f: Fixture, text: string) {
  const saved = await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text, attachments: [] });
  await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: saved.revision!, delivery: "queue" });
}
async function terminal(f: Fixture) {
  await waitFor(() => !f.session().turnId && ["completed", "failed", "partial", "stopped"].includes(f.session().status), 90000);
  assert.equal(f.session().status, "completed", f.session().lastError ?? "");
}
async function fixture() {
  assert.ok(native);
  const f = await nativeMilestoneFixture(native, "scripts");
  await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: f.modelId });
  return f;
}

for (const kind of ["safe", "unsafe", "url", "url-invalid"] as const) test(`actual native ${kind} script review keeps source, approval and process ownership in the guest`, {
  skip: !native, timeout: 180000,
}, async () => {
  const f = await fixture();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    const source = `test ! -e ${JSON.stringify(join(f.project, "fixture.txt"))} || exit 29\ntest -z "$GITHUB_TOKEN$GH_TOKEN$OPENAI_API_KEY" || exit 31\nprintf GENERATED_NATIVE_SCRIPT_RUN > generated-script-result.txt\n`;
    await writeFile(join(f.project, "generated-script.sh"), source);
    await send(f, `generated native script ${kind}${kind === "unsafe" ? " attempt" : ""}`);
    if (kind.startsWith("url")) {
      const approval = await waitFor(() => f.session().pendingApproval?.call.name === "review_script" && f.session().pendingApproval, 30000);
      assert.equal(approval.call.arguments.url, "https://api.githubcopilot.com/generated-source.sh");
      await f.sdk.approvals.respond(f.sessionId, approval.id, true);
    }
    if (kind === "unsafe" || kind === "url-invalid") {
      await terminal(f);
      assert.equal(f.session().pendingApproval, null);
      const records = f.service.controller.snapshot().scriptReviews.filter((review) => review.sessionId === f.sessionId);
      if (kind === "url-invalid") {
        assert.deepEqual(records, []);
        assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.requested" && event.session_id === f.sessionId &&
          event.payload.approval.call.name === "run_script"), false);
        return;
      }
      const review = records.at(-1)!;
      assert.equal(review.advice?.verdict, "unsafe"); assert.equal(review.attempt, null);
      assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.requested" && event.session_id === f.sessionId &&
        event.payload.approval.call.name === "run_script"), false);
      await assert.rejects(() => access(join(stage(f), "generated-script-result.txt")), { code: "ENOENT" });
      const modelCalls = f.service.controller.snapshot().budgetEntries.length, originalGuest = f.service.controller.snapshot().sandboxExecutions!.at(-1)!.id;
      const forceIds = ["generated-original-native-force", "generated-concurrent-native-force"];
      const attempts = await Promise.allSettled(forceIds.map((id) =>
        f.sdk.scriptReviews.force(f.sessionId, review.id, review.source.digest, review.revision, f.session().revision, id)));
      const winner = attempts.find((value) => value.status === "fulfilled");
      assert.ok(winner?.status === "fulfilled"); assert.equal(attempts.filter((value) => value.status === "fulfilled").length, 1);
      const forced = winner.value;
      const commandId = f.service.controller.snapshot().scriptReviews.find((value) => value.id === review.id)?.force?.commandId;
      assert.ok(commandId && forceIds.includes(commandId));
      const approval = await waitFor(() => f.session().pendingApproval?.call.name === "run_script" && f.session().pendingApproval);
      await assert.rejects(() => access(join(stage(f), "generated-script-result.txt")), { code: "ENOENT" });
      await f.sdk.approvals.respond(f.sessionId, approval.id, true);
      assert.equal((await f.sdk.jobs.wait(forced.id!)).status, "completed");
      const read = await f.sdk.scriptReviews.read(f.sessionId, review.id);
      assert.equal(read.review.force?.actor, "user"); assert.equal(read.review.attempt?.ownerId, commandId);
      assert.notEqual(read.review.nativeExecution?.executionId, originalGuest);
      assert.equal(read.executionResult?.outcome, "completed");
      assert.equal(f.service.controller.snapshot().budgetEntries.length, modelCalls);
      f.sdk.disconnect(); await f.service.close();
      reopened = await startService(f.restartOptions); sdk = await new MoguriSdk(reopened.connection).ready();
      const restored = await sdk.scriptReviews.read(f.sessionId, review.id);
      assert.deepEqual(restored, read);
      reopened.store.db.prepare("DELETE FROM receipts WHERE id=?").run(commandId);
      await assert.rejects(() => sdk!.scriptReviews.force(f.sessionId, review.id, review.source.digest, read.review.revision, undefined, commandId), /original|retained|exact|revision/i);
      assert.equal(reopened.controller.snapshot().budgetEntries.length, modelCalls);
      return;
    }
    const approval = await waitFor(() => f.session().pendingApproval?.call.name === "run_script" && f.session().pendingApproval, 30000);
    await assert.rejects(() => access(join(stage(f), "generated-script-result.txt")), { code: "ENOENT" });
    await f.sdk.approvals.respond(f.sessionId, approval.id, true);
    await terminal(f);
    const review = f.service.controller.snapshot().scriptReviews.findLast((review) => review.sessionId === f.sessionId)!;
    const read = await f.sdk.scriptReviews.read(f.sessionId, review.id);
    assert.equal(read.text, kind === "url" ? "printf GENERATED_NATIVE_URL_RUN > generated-script-result.txt\n" : source);
    assert.equal(read.executionResult?.outcome, "completed");
    assert.notEqual(review.nativeExecution?.rootDigest, review.nativeExecution?.guestRootDigest);
    assert.equal(await readFile(join(stage(f), "generated-script-result.txt"), "utf8"), kind === "url" ? "GENERATED_NATIVE_URL_RUN" : "GENERATED_NATIVE_SCRIPT_RUN");
    await assert.rejects(() => access(join(f.project, "generated-script-result.txt")), { code: "ENOENT" });
    const proof = JSON.parse(await readFile(join(stage(f), "generated-native-script-proof.json"), "utf8"));
    assert.equal(proof.platform, "linux"); assert.ok(proof.uid > 0);
    assert.equal(proof.sourceReads, kind === "url" ? 1 : 0);
    assert.equal(f.requests.length, 0, "Controller model inference is not a guest substitute.");
    const execution = f.service.controller.snapshot().sandboxExecutions!.find((value) => value.id === review.nativeExecution!.executionId)!;
    assert.equal(execution.cleanup, "owned-guest-stopped"); assert.equal(f.service.controller.sandbox.owns(execution.id), false);
  } finally { sdk?.disconnect(); await reopened?.close(); await f.close(); }
});

test("native user-script cancellation retains one partial attempt, stops its guest and never creates another model call", {
  skip: !native, timeout: 180000,
}, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.project, "generated-script.sh"), "printf GENERATED_BUSY > generated-script-started.txt\nwhile :; do :; done\n");
    await send(f, "generated native script unsafe busy"); await terminal(f);
    const review = f.service.controller.snapshot().scriptReviews.findLast((review) => review.sessionId === f.sessionId)!;
    const calls = f.service.controller.snapshot().budgetEntries.length;
    const job = await f.sdk.scriptReviews.force(f.sessionId, review.id, review.source.digest, review.revision);
    const approval = await waitFor(() => f.session().pendingApproval?.call.name === "run_script" && f.session().pendingApproval);
    await f.sdk.approvals.respond(f.sessionId, approval.id, true);
    const root = stage(f);
    await waitFor(() => existsSync(join(root, "generated-script-started.txt")), 30000);
    assert.equal(await readFile(join(root, "generated-script-started.txt"), "utf8"), "GENERATED_BUSY");
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    assert.equal((await f.sdk.jobs.wait(job.id!)).status, "partial");
    const retained = await f.sdk.scriptReviews.read(f.sessionId, review.id);
    assert.ok(retained.review.nativeExecution); assert.equal(retained.review.attempt?.owner, "user");
    const execution = f.service.controller.snapshot().sandboxExecutions!.find((value) => value.id === retained.review.nativeExecution!.executionId)!;
    assert.equal(execution.cleanup, "owned-guest-stopped"); assert.equal(f.service.controller.sandbox.owns(execution.id), false);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, calls);
    await assert.rejects(() => access(join(f.project, "generated-script-started.txt")), { code: "ENOENT" });
    await assert.rejects(() => f.sdk.scriptReviews.force(f.sessionId, review.id, review.source.digest, retained.review.revision), /original|retained|exact|revision/i);
  } finally { await f.close(); }
});
