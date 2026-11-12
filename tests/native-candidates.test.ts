import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, type CandidatePatch, type CompoundSettings } from "../packages/sdk/src/index.ts";
import { compoundModelBinding } from "../apps/service/src/compound-policy.ts";
import { digest } from "../apps/service/src/store.ts";
import { sandboxContainerInventory } from "../apps/service/src/apple-container.ts";
import { sandboxHostEnvironment } from "../apps/service/src/sandbox-runtime.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeMilestoneFixture } from "./fixtures/native-milestone-api.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { waitFor } from "./fixture.ts";

const native = await nativeConfiguration(true);
type Fixture = Awaited<ReturnType<typeof nativeMilestoneFixture>>;
const validationCommand = `/usr/local/bin/node -e "if(require('node:fs').readFileSync('fixture.txt','utf8')!=='Generated passing native candidate.\\n')process.exit(7);console.log('GENERATED_REAL_NATIVE_PROJECT_TEST_PASSED')"`;

async function prepared(scenario: "milestone" | "compound" = "milestone") {
  assert.ok(native);
  const f = await nativeMilestoneFixture(native, scenario);
  try {
    await writeFile(join(f.project, "second.txt"), "Generated second source.\n", { mode: 0o644 });
    const git = initializeGeneratedRepository(f.project, ["fixture.txt", "second.txt"]);
    await writeFile(join(f.project, "unrelated.txt"), "Generated unrelated staged intent.\n"); git(["add", "--", "unrelated.txt"]);
    if (scenario === "compound") {
      const { configuration } = await f.sdk.projects.configuration(f.session().projectId);
      await f.sdk.projects.configure(configuration.projectId, { ...configuration.values,
        scripts: [{ id: "generated-native-validation", name: "Generated native project check", command: validationCommand }] }, configuration.revision);
    }
    const review = (await f.sdk.sandbox.preview(f.sessionId, ["fixture.txt", "second.txt"])).preview;
    await f.sdk.sandbox.prepare(f.sessionId, ["fixture.txt", "second.txt"], review.digest, f.session().revision);
    const index = await readFile(join(f.project, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const stage = async (name: string) => {
      const preview = (await f.sdk.candidates.workspacePreview(f.sessionId, name)).preview;
      const workspace = await f.sdk.candidates.waitWorkspace((await f.sdk.candidates.createWorkspace(f.sessionId, name, preview.digest, true)).id!);
      assert.equal(workspace.status, "ready", workspace.diagnostic ?? ""); assert.ok(workspace.stage);
      return workspace;
    };
    return { ...f, git, index, head, stage };
  } catch (error) { await f.close(); throw error; }
}

function workspace(f: Fixture) {
  const value = f.service.controller.snapshot().sandboxWorkspaces?.find((value) => value.id === f.session().sandboxWorkspaceId);
  assert.ok(value?.stage); return { ...value, stage: value.stage };
}

function privatePath(f: Fixture, path: string) {
  assert.ok(path.startsWith("/workspace/"));
  return join(workspace(f).stage.workspace, path.slice("/workspace/".length));
}

async function absent(f: Fixture) {
  const records = (await f.sdk.candidates.transports({ sessionId: f.sessionId })).transports;
  assert.ok(records.length);
  const inventory = sandboxContainerInventory(JSON.parse(await runProgram("/usr/local/bin/container", ["ls", "--all", "--format", "json"], {
    cwd: f.state, env: sandboxHostEnvironment(), signal: AbortSignal.timeout(5000), timeoutMs: 5000, label: "Exact native candidate ownership",
  })));
  for (const record of records) {
    assert.equal(record.boundary.env, "Sandbox");
    const launch: unknown = JSON.parse(record.launchJson), observation: unknown = JSON.parse(record.observationJson!);
    assert.ok(isRecord(launch) && launch.kind === "Sandbox" && isRecord(launch.execution));
    assert.ok(isRecord(observation)); assert.match(String(observation.nativeSessionId), /^[a-f0-9]{32}$/);
    assert.match(String(observation.planDigest), /^[a-f0-9]{64}$/); assert.ok(observation.signerFingerprint);
    const launchName = launch.execution.launchName;
    assert.ok(typeof launchName === "string");
    assert.equal(inventory.some((entry) => entry.configuration.id === `${launchName}-${observation.nativeSessionId}`), false);
  }
  return records;
}

test("actual native candidates stage only in their owned snapshot, require separate source acceptance and publish only a fresh signed result", {
  skip: !native, timeout: 240000,
}, async () => {
  const f = await prepared();
  try {
    const source = await f.sdk.candidates.source(f.sessionId, ["fixture.txt", "second.txt"]), stage = await f.stage("Generated native reviewed stage");
    assert.equal(source.source.env, "Sandbox"); assert.equal("head" in source.source, false);
    const patch: CandidatePatch = { kind: "patch", summary: "Generated private native proposal.",
      edits: source.files.map((file, index) => ({ path: file.path, baseDigest: file.baseDigest, text: `Generated accepted native file ${index}.\n` })) };
    const review = (await f.sdk.candidates.preview(f.sessionId, stage.id, patch)).preview;
    await assert.rejects(() => f.sdk.candidates.stage(f.sessionId, stage.id, patch, "0".repeat(64)), /review|changed/i);
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, stage.id, patch, review.digest)).id!);
    assert.equal(staged.candidate.status, "staged"); assert.equal(staged.candidate.acceptance, null);
    assert.deepEqual((await f.sdk.candidates.source(f.sessionId, ["fixture.txt", "second.txt"])).files, source.files);
    const application = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    await assert.rejects(() => f.sdk.candidates.apply(staged.candidate.id, f.sessionId, application.revision, "0".repeat(64)), /review|changed/i);
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Local", "Remote"] });
    await assert.rejects(() => f.sdk.candidates.apply(staged.candidate.id, f.sessionId, application.revision, application.digest), /policy|allowed|environment|denied/i);
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Local", "Sandbox", "Remote"] });
    const fresh = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
    await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, fresh.revision, fresh.digest);
    const applied = await f.sdk.candidates.wait(staged.candidate.id);
    assert.equal(applied.candidate.status, "applied"); assert.equal(applied.candidate.acceptance?.actor, "user");
    const actual = await f.sdk.candidates.source(f.sessionId, patch.edits.map((edit) => edit.path));
    assert.deepEqual(actual.files.map(({ path, text }) => ({ path, text })), patch.edits.map(({ path, text }) => ({ path, text })));
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 0); assert.equal(f.requests.length + f.solver.requests.length, 0);
    assert.ok((await absent(f)).every((record) => record.status === "completed" && record.terminalAcknowledged && record.cleanupConfirmed));
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0,
      text: "Generated explicit fresh snapshot Sandbox/fixed/Manual/unlimited/maximum/default/text", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !f.session().turnId && ["completed", "failed", "partial"].includes(f.session().status), 30000);
    assert.equal(f.session().status, "completed", f.session().lastError ?? "");
    const execution = f.service.controller.snapshot().sandboxExecutions?.findLast((entry) => entry.sessionId === f.sessionId);
    assert.ok(execution); assert.equal(execution.cleanup, "owned-guest-stopped");
    const result = (await f.sdk.sandbox.result(execution.id)).result!;
    assert.equal(result.journal.status, "verified");
    for (const edit of patch.edits) assert.equal(result.files.find((file) => file.path === edit.path)?.text, edit.text);
    const publication = (await f.sdk.sandbox.publicationPreview(execution.id, patch.edits.map((edit) => edit.path))).preview;
    const published = await f.sdk.sandbox.waitPublication((await f.sdk.sandbox.publish(execution.id, patch.edits.map((edit) => edit.path),
      publication.digest, execution.revision)).id!);
    assert.equal(published.publication.status, "completed", published.publication.diagnostic ?? "");
    assert.equal(published.publication.acceptance.actor, "user");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.deepEqual(await readFile(join(f.project, ".git/index")), f.index); assert.equal(f.git(["rev-parse", "HEAD"]), f.head);
    assert.equal(await readFile(join(f.project, "unrelated.txt"), "utf8"), "Generated unrelated staged intent.\n");
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.equal((await f.sdk.candidates.workspace(stage.id)).workspace.status, "ready");
    assert.equal(f.service.controller.snapshot().candidates.some((candidate) => candidate.id === staged.candidate.id), false);
    assert.equal((await f.sdk.sandbox.publication(published.publication.id)).publication.status, "completed");
  } finally { await f.close(); }
});

test("a real native candidate effect with a lost result receipt stays partial; original read-only reconciliation and command recovery never relaunch it", {
  skip: !native, timeout: 240000,
}, async (t) => {
  const f = await prepared();
  try {
    const source = await f.sdk.candidates.source(f.sessionId, ["fixture.txt"]), stage = await f.stage("Generated native partial stage");
    const patch: CandidatePatch = { kind: "patch", summary: "Generated native lost receipt.",
      edits: [{ path: "fixture.txt", baseDigest: source.files[0]!.baseDigest, text: "Generated actual native effect.\n" }] };
    const preview = (await f.sdk.candidates.preview(f.sessionId, stage.id, patch)).preview;
    const commit = f.service.store.commit.bind(f.service.store), launch = f.service.controller.sandbox.launch.bind(f.service.controller.sandbox);
    let lost = false, launches = 0;
    t.mock.method(f.service.controller.sandbox, "launch", (...args: Parameters<typeof launch>) => { launches++; return launch(...args); });
    t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!lost && args[0].some((event) => event.event_type === "candidate.transport_recorded" && event.payload.transport.ownerKind === "candidate" && event.payload.transport.resultDigest)) {
        lost = true;
        assert.equal(readFileSync(privatePath(f, `${stage.stage!.root}/fixture.txt`), "utf8"), patch.edits[0]!.text);
        throw new Error("Generated lost actual native candidate result receipt.");
      }
      return commit(...args);
    });
    const command = { type: "candidate.stage" as const, sessionId: f.sessionId, stageWorkspaceId: stage.id, patch, expectedDigest: preview.digest, confirm: true as const }, id = randomUUID();
    const admitted = await f.sdk.command(command, id), candidate = await f.sdk.candidates.wait(admitted.id!);
    assert.equal(lost, true); assert.equal(candidate.candidate.status, "partial"); assert.equal(candidate.candidate.acceptance, null);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const record = (await f.sdk.candidates.transports({ ownerId: candidate.candidate.id })).transports.find((record) => record.status === "partial");
    assert.ok(record); assert.equal(record.resultDigest, null); assert.equal(record.terminalAcknowledged, false);
    const before = launches;
    await f.sdk.candidates.reconcileTransport(record.id, record.revision);
    const recovered = (await f.sdk.candidates.transport(record.id)).transport;
    assert.equal(recovered.status, "partial"); assert.equal(recovered.terminalAcknowledged, false);
    assert.equal(recovered.cleanupConfirmed, true); assert.equal(recovered.recovery?.evidence.guest?.absent, true);
    assert.ok(recovered.resultDigest); assert.equal(launches, before);
    f.service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(id);
    assert.equal((await f.sdk.command(command, id)).id, admitted.id); assert.equal(launches, before);
    assert.equal((await f.sdk.candidates.read(admitted.id!)).candidate.status, "partial");
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 0);
    assert.equal(f.requests.length + f.solver.requests.length, 0);
    await absent(f);
    assert.deepEqual(await readFile(join(f.project, ".git/index")), f.index); assert.equal(f.git(["rev-parse", "HEAD"]), f.head);
  } finally { await f.close(); }
});

async function workflow(f: Fixture, id: string, expected: "waiting_validation" | "proposed" | "stopped") {
  return waitFor(() => {
    const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
    if (record && !["running", "validating", "waiting_validation", expected].includes(record.status)) throw new Error(`Native workflow ${record.status}: ${record.diagnostic}`);
    return record?.status === expected && (expected === "waiting_validation" || !f.session().turnId) ? record : null;
  }, 60000);
}

for (const pattern of ["cascade", "critique"] as const) test(`actual native ${pattern} owns tool-less roles and reviewed guest project tests without accepting source`, {
  skip: !native, timeout: 300000,
}, async () => {
  const f = await prepared("compound");
  try {
    const lineageText = "Generated synthetic lineage claim; no real-model independence or quality qualification.";
    const models = f.service.controller.snapshot().provider.models, draft = models.find((model) => model.id === f.solverId)!, critic = models.find((model) => model.id === f.modelId)!;
    const policy: CompoundSettings = { enabled: true, workflow: "compound", classifierModelId: f.modelId, approvedModelIds: [f.solverId, f.modelId],
      allowHosted: true, minimumConfidence: 0.9, limits: { routerTokens: 512, proposalTokens: 2048, criticTokens: 1024, timeoutMs: 120000 },
      routes: pattern === "cascade" ? [{ id: "generated-native-cascade", pattern, draftId: f.solverId, escalationId: f.modelId }] :
        [{ id: "generated-native-critique", pattern, draftId: f.solverId, criticId: f.modelId, lineageReviewId: "generated-native-lineage" }],
      lineageReviews: pattern === "cascade" ? [] : [{ version: 1, id: "generated-native-lineage", actor: "user",
        draftBindingDigest: compoundModelBinding(draft), criticBindingDigest: compoundModelBinding(critic), draftLineage: "generated-alpha", criticLineage: "generated-beta",
        sourceKind: "reviewed-training-report", sourceUrl: "https://generated.example.invalid/lineage", sourceText: lineageText, sourceDigest: digest(lineageText),
        reviewedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(), limitations: lineageText }] };
    await f.sdk.routing.configure(policy, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: "kupo",
      modelOptions: { contextWindow: 98305, thinkingEffort: "high" }, budget: { kind: "limited", basis: "estimate", tokens: 1000000 } });
    const stage = await f.stage("Generated native draft"), alternate = await f.stage("Generated native alternate");
    const input = { sessionId: f.sessionId, draftWorkspaceId: stage.id, alternateWorkspaceId: alternate.id,
      input: { task: "Generated native reviewed implementation.", files: [{ path: "fixture.txt", baseDigest: digest("generated original\n") }] },
      requestPlan: "Generated reviewed plan.", requestArchitecture: "Generated reviewed architecture.",
      validationScriptId: "generated-native-validation", validationTimeoutMs: 10000 };
    const start = async () => f.sdk.compound.start(input, (await f.sdk.compound.preview(input)).preview.digest, true);
    if (pattern === "critique") {
      const denied = await start(), pending = await workflow(f, denied.id!, "waiting_validation"), read = await f.sdk.compound.read(denied.id!);
      await f.sdk.compound.review(denied.id!, read.pendingValidation!.validationId, pending.revision, read.pendingValidation!.digest, false);
      assert.equal((await workflow(f, denied.id!, "stopped")).validations[0]?.status, "denied");
      assert.equal(f.service.controller.snapshot().candidates.length, 0);
      assert.deepEqual(f.service.controller.snapshot().budgetEntries.filter((entry) => entry.turnId === denied.id).map((entry) => entry.role), ["router", "draft"]);
      assert.equal((await f.sdk.candidates.source(f.sessionId, ["fixture.txt"])).files[0]?.text, "generated original\n");
    }
    const admitted = await start(), pending = await workflow(f, admitted.id!, "waiting_validation"), read = await f.sdk.compound.read(admitted.id!);
    await f.sdk.compound.review(admitted.id!, read.pendingValidation!.validationId, pending.revision, read.pendingValidation!.digest, true);
    const done = await workflow(f, admitted.id!, "proposed"), report = await f.sdk.compound.read(done.id);
    assert.match(report.validations[0]!.result!.text, /GENERATED_REAL_NATIVE_PROJECT_TEST_PASSED/);
    assert.equal(report.validations[0]!.result!.stage.env, "Sandbox");
    assert.equal((await f.sdk.candidates.read(done.selectedCandidateId!)).candidate.acceptance, null);
    assert.equal((await f.sdk.candidates.source(f.sessionId, ["fixture.txt"])).files[0]?.text, "generated original\n");
    const entries = f.service.controller.snapshot().budgetEntries.filter((entry) => entry.turnId === done.id);
    assert.deepEqual(entries.map((entry) => entry.role), pattern === "cascade" ? ["router", "draft"] : ["router", "draft", "critic"]);
    assert.ok(entries.every((entry) => entry.env === "Sandbox" && entry.status === "settled" && entry.reportedTokens === 42));
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.billedUsd, null);
    const witness = JSON.parse(await readFile(join(workspace(f).stage.workspace, ".moguri/generated-native-compound.json"), "utf8"));
    assert.equal(witness.platform, "linux"); assert.ok(witness.uid > 0);
    for (const call of witness.calls) {
      assert.equal(call.request.tools?.length ?? 0, 0);
      assert.equal(JSON.stringify(call.request).includes(f.project), false);
      assert.ok(call.request.max_tokens <= 2048);
    }
    for (const role of report.roles.filter((role) => role.step.role !== "router")) assert.equal(role.input?.includes("GENERATED_NATIVE_ROUTER_REASON_NOT_CONTEXT"), false);
    const candidate = (await f.sdk.candidates.read(done.selectedCandidateId!)).candidate, apply = (await f.sdk.candidates.applyPreview(candidate.id, f.sessionId)).preview;
    await f.sdk.candidates.apply(candidate.id, f.sessionId, apply.revision, apply.digest);
    assert.equal((await f.sdk.candidates.wait(candidate.id)).candidate.acceptance?.actor, "user");
    assert.equal((await f.sdk.candidates.source(f.sessionId, ["fixture.txt"])).files[0]?.text, "Generated passing native candidate.\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.deepEqual(await readFile(join(f.project, ".git/index")), f.index); assert.equal(f.git(["rev-parse", "HEAD"]), f.head);
    assert.equal(f.requests.length + f.solver.requests.length, 0);
    await absent(f);
  } finally { await f.close(); }
});
