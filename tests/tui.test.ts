import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { MoguriSdk as MoguriClient } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { compactionFixture } from "./fixtures/compaction-service.ts";
import { remotePlanFixture } from "./fixtures/remote-plan-service.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { generatedRepositoryMetadata } from "./fixtures/repository-info.ts";
import { remoteGithubFixture } from "./fixtures/remote-github-service.ts";
import { remoteMemoryFixture } from "./fixtures/remote-memory-service.ts";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { candidateGenerationFixture } from "./fixtures/candidate-generation-api.ts";
import { roleSequenceFixture } from "./fixtures/role-sequence-api.ts";
import { roleProposalFixture } from "./fixtures/role-proposal-api.ts";
import { modelEvidenceFixture } from "./fixtures/model-evidence-api.ts";
import { roleContractFixture } from "./fixtures/role-contract-api.ts";
import { nativePublicationFixture } from "./fixtures/native-publication.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { winddownApiFixture } from "./fixtures/winddown-api.ts";

const nativeSandbox = await nativeConfiguration();
test("actual TUI thinking, effort and exact context shortcuts share saved model controls without inference", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32769 }), client = await new MoguriClient(fixture.service.connection).ready();
  await fixture.configure(); await client.refresh();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI model shortcut did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    for (const [command, expected] of [["/thinking high", "Thinking effort set to high"], ["/effort low", "Thinking effort set to low"], ["/context-window 24577", "Context window set to 24,577"], ["/thinking default", "Thinking effort set to the model default"]] as const) {
      await setup.mockInput.typeText(command); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected);
    }
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 24577 });
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("TUI /archive asks how to handle subsessions and remembers the selected cascade", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  const child = await client.sessions.spawn(fixture.sessionId, "agent", "Generated archive child");
  const setup = await createTestRenderer({ width: 140, height: 50, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI session archive did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/archive"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Archive all attached subsessions");
    await setup.mockInput.pressArrow("down"); await setup.mockInput.pressArrow("down");
    await frameUntil("Archive all and don't ask me again");
    setup.mockInput.pressEnter();
    await waitFor(() => client.getState().snapshot?.sessions.every((session) => session.status === "archived"));
    assert.equal(client.getState().snapshot!.sessions.find((session) => session.id === child.id)?.status, "archived");
    assert.equal(client.settings.get()?.values.retention.archiveChildren, "archive");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("actual TUI model dropdown selects default automatic Kupo and runs its sole model without a classifier", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 150, height: 50, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`Automatic Kupo TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    setup.mockInput.pressKey("m", { ctrl: true }); await frameUntil("Automatic Single / Cascade");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().controls.modelId === "kupo"); await frameUntil("Write a prompt");
    assert.equal(fixture.requests.length, 0);
    await setup.mockInput.typeText("Generated terminal automatic Kupo task."); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await fixture.terminal(); await frameUntil("The requested fixture operation is complete.");
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["solver"]);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("actual TUI keys review reserved budget data and separately create an accepted-work checkpoint branch without another model or source index/HEAD change", { skip: process.platform !== "darwin", timeout: 25000 }, async () => {
  const f = await winddownApiFixture({ git: true }), accepted = await f.accept(), checkpoint = await f.run(); assert.ok(f.git);
  const index = await readFile(join(f.project, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
  const setup = await createTestRenderer({ width: 180, height: 90, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI wind-down did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk })));
    const input = { winddownId: checkpoint.winddown.id, candidateIds: [accepted.candidate.id], branch: "moguri/generated-tui-budget-checkpoint", message: "chore: retain accepted TUI checkpoint" };
    await slash("/winddown commit-preview " + JSON.stringify(input), '"winddown.commit.preview"'); setup.mockInput.pressEscape();
    const review = await f.sdk.winddown.commitPreview({ ...input, sessionId: f.sessionId });
    await slash(`/winddown commit ${review.preview.revision} ${review.preview.digest} confirm-git ${JSON.stringify(input)}`, '"winddown.read"');
    assert.equal((await f.sdk.winddown.read(checkpoint.winddown.id)).winddown.status, "completed"); setup.mockInput.pressEscape();
    await slash(`/artifact edit ${checkpoint.winddown.id}`, "Wind-down metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI budget checkpoint", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await f.sdk.artifacts.read(checkpoint.winddown.id)).artifact.name, "Generated TUI budget checkpoint");
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.requests.length, 1);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("actual TUI keys review public compound cost and exact host tests, inspect the recommendation and edit only independent report metadata", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const f = await compoundApiFixture(); await f.configure();
  const setup = await createTestRenderer({ width: 180, height: 90, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 10000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI public compound did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk })));
    const selection = Object.fromEntries(Object.entries(f.input).filter(([key]) => key !== "sessionId"));
    await slash(`/compound preview ${JSON.stringify(selection)}`, '"compound.preview"'); setup.mockInput.pressEscape();
    const preview = await f.sdk.compound.preview(f.input);
    await slash(`/compound start ${preview.preview.digest} confirm-cost ${JSON.stringify(selection)}`, '"revision": 0');
    const pending = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows[0];
      return value?.status === "waiting_validation" ? value : null;
    });
    assert.equal(await f.source(), "generated original\n"); setup.mockInput.pressEscape();
    await slash(`/compound validation ${pending.id}`, '"compound.validation.preview"');
    await frameUntil("Generated plan: replace only the reviewed fixture.");
    const review = await f.sdk.compound.validationPreview(pending.id);
    setup.mockInput.pressEscape();
    await slash(`/compound review ${pending.id} ${review.review.validationId} ${review.revision} ${review.review.digest} confirm-stage-and-test`, "Actual-user staging and exact project tests authorized");
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "proposed" && !f.session().turnId);
    assert.equal(await f.source(), "generated original\n"); setup.mockInput.pressEscape();
    await slash(`/artifact edit ${pending.id}`, "Compound workflow metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI compound report", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await f.sdk.artifacts.read(pending.id)).artifact.name, "Generated TUI compound report");
    assert.equal((await f.sdk.compound.read(pending.id)).workflow.validations[0]?.status, "passed");
    assert.equal(f.requests.length, 1); assert.equal(f.providers[1]!.requests.length, 1); assert.equal(f.providers[2]!.requests.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("native TUI keys review retained Sandbox outputs and confirm separate source publication without a model call", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const fixture = await nativePublicationFixture(), setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`Native publication review did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/sandbox publish-preview ${fixture.execution.id} ["fixture.txt"]`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"sandbox.publication.preview"');
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), "generated original\n");
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    const preview = (await fixture.sdk.sandbox.publicationPreview(fixture.execution.id, ["fixture.txt"])).preview;
    await setup.mockInput.typeText(`/sandbox publish ${JSON.stringify({ executionId: fixture.execution.id, paths: ["fixture.txt"], expectedDigest: preview.digest, expectedRevision: 0 })} confirm-publish`);
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil('"sandbox.publication"');
    assert.equal(fixture.service.controller.snapshot().sandboxPublications?.[0]?.acceptance.actor, "user");
    assert.equal(await readFile(join(fixture.root, "fixture.txt"), "utf8"), fixture.result.files[0]!.text);
    const publication = fixture.service.controller.snapshot().sandboxPublications![0]!;
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/artifact edit ${publication.id}`); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Native report metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI native metadata", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await fixture.sdk.artifacts.read(publication.id)).artifact.name, "Generated TUI native metadata");
    assert.equal((await fixture.sdk.sandbox.publication(publication.id)).publication.documentDigest, publication.documentDigest);
    assert.equal(fixture.requests.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("actual native TUI qualifies the guest, prepares reviewed source, holds a queued prompt and uses exact human tool/publication decisions", { skip: !nativeSandbox, timeout: 90_000 }, async () => {
  assert.ok(nativeSandbox);
  const fixture = await nativeApiFixture(nativeSandbox), { sdk, provider, project, service } = fixture;
  await reviewNativeTools(sdk);
  const bound = await sdk.command({ type: "project.add", path: project }), created = await sdk.sessions.create(bound.id!);
  const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id)!;
  await sdk.sessions.configure(created.id!, { ...session().controls, modelId: provider.modelId });
  const settings = structuredClone(sdk.settings.get()!);
  await sdk.settings.update({ ...settings.values, sandbox: fixture.reviewedConfiguration }, settings.revision);
  const setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 15_000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`Actual native TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected); };
  let passed = false;
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await slash("/sandbox probe confirm-native", '"ready": true'); setup.mockInput.pressEscape();
    await frameUntil("Write a prompt"); await setup.mockInput.typeText("/env Sandbox"); setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => session().controls.env === "Sandbox");
    await slash('/sandbox preview ["fixture.txt"]', '"sandbox.preview"'); setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    const preview = (await sdk.sandbox.preview(created.id!, ["fixture.txt"])).preview;
    await slash(`/sandbox prepare ${JSON.stringify({ paths: ["fixture.txt"], expectedDigest: preview.digest, expectedRevision: session().revision })} confirm-stage`, "private native stage prepared");
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("generated native write"); setup.mockInput.pressEnter({ ctrl: true });
    const held = await waitFor(() => session().queue.find((item) => item.held));
    assert.equal(session().turnId, null); assert.equal(service.controller.snapshot().budgetEntries.length, 0);
    await slash(`/run ${held.id}`, "Write a prompt");
    await waitFor(() => session().pendingApproval?.call.name === "read_file", 20_000);
    await frameUntil("read_file"); await frameUntil("Ctrl+Y approve");
    setup.mockInput.pressKey("y", { ctrl: true });
    await waitFor(() => session().pendingApproval?.call.name === "write_file", 20_000);
    await frameUntil("write_file");
    setup.mockInput.pressKey("y", { ctrl: true });
    await waitFor(() => !session().turnId && session().status === "completed", 20_000);
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    const execution = service.controller.snapshot().sandboxExecutions!.find((value) => value.sessionId === created.id)!;
    const review = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"])).preview;
    await slash(`/sandbox publish ${JSON.stringify({ executionId: execution.id, paths: ["fixture.txt"], expectedDigest: review.digest, expectedRevision: execution.revision })} confirm-publish`, '"sandbox.publication"');
    assert.equal(service.controller.snapshot().sandboxPublications?.[0]?.status, "completed");
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated native replacement\n");
    assert.equal(session().usage.length, 3); assert.equal(provider.requests.length, 0); passed = true;
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(passed); }
});

test("native bracketed paste preserves exact long text in a scoped file after a Unicode cursor and keeps queue-only semantics", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 45, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`Generated paste composer did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil("Write a prompt");
    await setup.mockInput.pasteBracketedText("Before \u754c \u{1f34a} ");
    const text = Array.from({ length: 51 }, (_, index) => `Generated terminal clipboard ${index} \u{1f34a}`).join("\r\n");
    await setup.mockInput.pasteBracketedText(text);
    await waitFor(() => fixture.session().draft.attachments[0]?.kind === "paste_file");
    assert.equal(fixture.session().draft.text, "Before \u754c \u{1f34a} ");
    const attachment = fixture.session().draft.attachments[0]!;
    assert.deepEqual((await client.attachments.read(fixture.sessionId, attachment.id)).content, { kind: "text", text });
    await frameUntil("moguri-attachment/");
    setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => fixture.session().queue[0]?.held);
    assert.equal(fixture.session().queue[0]?.text, "Before \u754c \u{1f34a} ");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("native TUI keys inspect exact retained role contracts without dispatching, accepting or changing their input", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await roleContractFixture(), created = await f.run(); await f.settled(created.id);
  const setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI role contract did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/roles contract ${created.id} 2`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"role.contract.read"'); await frameUntil('"candidateIndex": 1');
    assert.equal(f.requests.length, 4); assert.equal(f.preparations(), 4); assert.equal(f.control.snapshot().candidates.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("native TUI keys read provider-declared metadata through the shared SDK without calling a model or treating it as approval", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await modelEvidenceFixture(), setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI provider evidence did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk }))); await frameUntil("Write a prompt");
    assert.equal(f.reads(), 0); await setup.mockInput.typeText("/model-evidence");
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil('"model.evidence"'); await frameUntil("generated-provider-declared-family");
    assert.equal(f.reads(), 1); assert.equal(f.requests.length, 0); assert.equal(f.session().controls.modelId, f.modelId);
    assert.equal((await f.sdk.budgets.calls()).calls.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("native TUI keys inspect final-role provenance and keep its origin through separate staging and actual-user application", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await roleProposalFixture(), setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI final-role proposal did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk })));
    await slash(`/candidate role-proposal ${f.sequence.id}`, '"candidate.role.proposal"'); setup.mockInput.pressEscape();
    const input = { stageWorkspaceId: f.workspace.id, patch: f.patch, roleSequenceId: f.sequence.id };
    await slash(`/candidate preview ${JSON.stringify(input)}`, '"candidate.preview"'); setup.mockInput.pressEscape();
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch, f.reference)).preview;
    await slash(`/candidate stage ${JSON.stringify({ ...input, expectedDigest: preview.digest })} confirm-stage`, '"candidate.read"');
    const candidate = await waitFor(() => f.control.snapshot().candidates.find((candidate) => candidate.status === "staged"));
    assert.equal(candidate.roleOrigin?.sequenceId, f.sequence.id); assert.equal(candidate.acceptance, null);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n"); setup.mockInput.pressEscape();
    const application = (await f.sdk.candidates.applyPreview(candidate.id, f.sessionId)).preview;
    await slash(`/candidate apply ${candidate.id} ${candidate.revision} ${application.digest} confirm-apply`, '"candidate.read"');
    await waitFor(() => f.control.snapshot().candidates.find((record) => record.id === candidate.id)?.status === "applied");
    assert.equal(f.control.snapshot().candidates[0]?.acceptance?.actor, "user");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text); assert.equal(f.requests.length, 3);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("native TUI keys inspect independent recorded roles and edit metadata without replacing raw inputs or calling a model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await roleSequenceFixture(); f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
  const original = f.current().inputDigest, setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI retained role did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/roles ${f.initial.id} 1`); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil('"role.sequence.read"');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/artifact edit ${f.initial.id}`); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Role sequence metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated native role metadata", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await f.sdk.artifacts.read(f.initial.id)).artifact.name, "Generated native role metadata"); assert.equal(f.current().inputDigest, original); assert.equal(f.requests.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("native TUI keys review one owned generated proposal and edit only retained metadata without staging source files", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await candidateGenerationFixture(), client = f.sdk;
  const setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI model generation did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    const preview = (await client.candidates.generatePreview(f.sessionId, f.workspace.id, f.input)).preview;
    await setup.mockInput.typeText(`/candidate generate ${JSON.stringify({ stageWorkspaceId: f.workspace.id, input: f.input, expectedDigest: preview.digest })} confirm-cost`);
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil('"candidate.generation.read"'); await frameUntil('"proposed"');
    const generation = f.service.controller.snapshot().candidateGenerations[0]!; assert.equal(f.requests.length, 1);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/artifact edit ${generation.id}`); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Generation metadata only");
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI model-proposal name", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await client.artifacts.read(generation.id)).artifact.name, "Generated TUI model-proposal name"); assert.equal(f.requests.length, 1);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("the native TUI inspects planned model holds separately from actual call history without dispatching a model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await budgetPlanFixture(), plan = f.create();
  const setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI planned accounting did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: f.sdk }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/dashboard plans ${JSON.stringify({ sessionId: f.sessionId })}`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"budget.plans"'); await frameUntil(plan.id);
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/dashboard calls"); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil('"calls": []');
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.plannedHolds, 1); assert.equal(f.requests.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("the native TUI stages and separately applies exact reviewed candidate bytes through the shared SDK without a model", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await candidateApiFixture(), client = f.sdk;
  const setup = await createTestRenderer({ width: 160, height: 65, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI candidate did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string, expected: string) => { await frameUntil("Write a prompt"); await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    const input = { stageWorkspaceId: f.workspace.id, patch: f.patch };
    await slash(`/candidate preview ${JSON.stringify(input)}`, '"candidate.preview"');
    const preview = (await client.candidates.preview(f.sessionId, f.workspace.id, f.patch)).preview;
    setup.mockInput.pressEscape();
    await slash(`/candidate stage ${JSON.stringify({ ...input, expectedDigest: preview.digest })} confirm-stage`, '"candidate.read"');
    const candidate = await waitFor(() => client.getState().snapshot!.candidates.find((candidate) => candidate.status === "staged"));
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    setup.mockInput.pressEscape();
    await slash(`/candidate apply-preview ${candidate.id}`, '"candidate.apply.preview"');
    const review = (await client.candidates.applyPreview(candidate.id, f.sessionId)).preview;
    setup.mockInput.pressEscape();
    await slash(`/candidate apply ${candidate.id} ${candidate.revision} ${review.digest} confirm-apply`, '"candidate.read"');
    await waitFor(() => client.getState().snapshot!.candidates.find((entry) => entry.id === candidate.id)?.status === "applied");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), f.patch.edits[0]!.text);
    assert.equal(client.getState().snapshot!.candidates[0]?.acceptance?.actor, "user"); assert.equal(f.requests.length, 0);
    setup.mockInput.pressEscape();
    await slash(`/artifact edit ${candidate.id}`, "Candidate metadata only");
    setup.mockInput.pressKey("a", { super: true });
    await setup.mockInput.typeText(JSON.stringify({ name: "Generated TUI immutable candidate name", status: "active", folderId: null, workItemId: null }));
    setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Retained independently");
    assert.equal((await client.artifacts.read(candidate.id)).artifact.name, "Generated TUI immutable candidate name");
    assert.equal((await client.candidates.read(candidate.id)).candidate.documentDigest, candidate.documentDigest);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("the actual TUI explicitly indexes and searches its pinned SSH repository without a provider or Local memory fallback", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture(), client = await new MoguriClient(f.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 55, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote memory did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/memory state"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"memory.state"'); await frameUntil('"env": "Remote"'); await frameUntil('"index": null');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/memory index"); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Repository index");
    await waitFor(() => f.controller.snapshot().jobs.some((job) => job.kind === "memory.index" && job.status === "completed"));
    await setup.mockInput.typeText("/memory search generated source"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"memory.search"'); await frameUntil("generated actual remote source");
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/memory remember Generated convention: prefer typed fixture functions."); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("User-authored project convention retained");
    assert.ok(f.controller.snapshot().registry.some((entry) => entry.kind === "memory" && entry.source === "user"));
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("the actual TUI reviews the captured SSH account and explicitly refreshes private repository metadata without a model", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteGithubFixture(), client = await new MoguriClient(f.service.connection).ready();
  const setup = await createTestRenderer({ width: 140, height: 55, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote repository metadata did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/repository preview"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"remote-gh-cli"'); await frameUntil('"hostFingerprint"');
    const preview = (await client.repositories.preview(f.sessionId)).preview;
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/repository refresh ${preview.bindingDigest} ${preview.revision} confirm-lookup`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Metadata refresh"); await waitFor(() => f.controller.snapshot().repositoryObservations.length === 1);
    await setup.mockInput.typeText("/repository state"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"repository.state"'); await frameUntil('"visibility": "private"');
    assert.equal((await f.github.records()).length, 1); assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await f.close(); }
});

test("the actual TUI explicitly opens and inspects a captured Remote user console without feeding stdin through the composer", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const fixture = await remoteFixture({ exposeModels: false, platform: { terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_TUI_REMOTE_CONSOLE\\n'; exec cat"] } } });
  const client = await new MoguriClient(fixture.service.connection).ready();
  await fixture.probe(); await client.sessions.env(fixture.sessionId, "Remote");
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote console did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (command: string, expected: string) => {
    await frameUntil("Write a prompt"); await setup.mockInput.typeText(command); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await slash("/terminals open", '"env": "Remote"');
    const terminal = fixture.controller.snapshot().terminals[0]!;
    assert.equal(terminal.env, "Remote"); assert.equal(terminal.binding?.root, fixture.workspace);
    setup.mockInput.pressEscape();
    await slash(`/terminals read ${terminal.id}`, '"terminal.read"');
    setup.mockInput.pressEscape();
    await slash(`/terminals close ${terminal.id}`, "Exact owned terminal stop observed");
    assert.equal(fixture.controller.snapshot().terminals[0]?.status, "closed");
    assert.equal(fixture.session().controls.modelId, null); assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI reviews, explicitly grants and revokes Remote MCP authority without a model or implicit forwarding", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await remoteFixture({ exposeModels: false }), client = await new MoguriClient(fixture.service.connection).ready();
  await fixture.probe(); await client.sessions.env(fixture.sessionId, "Remote");
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote MCP did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (command: string, expected: string) => {
    await frameUntil("Write a prompt"); await setup.mockInput.typeText(command); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil(expected);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await slash("/mcp-remote preview builtin", '"mcp.remote.preview"');
    const preview = (await client.mcp.remotePreview(fixture.sessionId, "builtin")).preview;
    assert.equal(preview.root, fixture.workspace); assert.equal(preview.granted, false);
    setup.mockInput.pressEscape();
    await slash(`/mcp-remote grant builtin ${preview.digest} ${preview.settingsRevision} confirm-reviewed`, "Exact peer/resource grant saved");
    assert.equal(client.settings.get()!.values.remote!.mcpGrants![0]!.forwardAccess, false);
    await fixture.probe(); await client.refresh();
    setup.mockInput.pressEscape();
    await slash("/mcp servers", '"mcp.servers"');
    setup.mockInput.pressEscape();
    await slash(`/mcp-remote revoke builtin ${client.settings.get()!.revision} confirm-revoke`, "Remote MCP grant revoked");
    assert.deepEqual(fixture.controller.snapshot().settings.values.remote!.mcpGrants, []);
    assert.equal(fixture.controller.snapshot().remoteMcpCalls.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().controls.modelId, null);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI keeps a pending Remote plan editor and stops only its owned save", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const fixture = await remotePlanFixture(), gate = holdRemoteFrame(t, fixture.controller.remote, "approval");
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI pending Remote plan did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/plan edit"); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Exact Remote plan");
    const text = "Generated pending terminal plan stays in its editor.";
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ text })); setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => gate.held); await frameUntil("Saving exact owned plan");
    setup.mockInput.pressEscape(); await frameUntil("The exact plan save is still settling.");
    setup.mockInput.pressKey("c", { ctrl: true }); await waitFor(() => fixture.session().status === "stopping"); gate.release();
    await waitFor(() => fixture.controller.snapshot().planSaves[0]?.status === "stopped");
    await frameUntil("Owned plan save stopped");
    await frameUntil("Exact Remote plan"); await frameUntil(text);
    assert.equal((await fixture.sdk.plans.saves(fixture.sessionId)).saves[0]?.status, "stopped");
    await assert.rejects(() => readFile(join(fixture.workspace, "docs/plan.md")), { code: "ENOENT" });
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    assert.equal(fixture.requests.length, 0);
  } finally { gate.release(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI edits and retains a reviewed Remote plan without a Local opener or model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await remotePlanFixture();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote plan did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk, native: { browser: async () => { throw new Error("No browser in Remote plan test."); }, file: async () => { throw new Error("No Local opener in Remote plan test."); }, copy: async () => {} } })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/plan edit"); setup.mockInput.pressEnter({ ctrl: true }); await frameUntil("Exact Remote plan");
    const text = "Generated terminal  exact Remote plan.\n\tGenerated retained indentation.\n";
    setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify({ text })); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Plan saved and independently retained"); await frameUntil("Write a prompt");
    assert.equal(await readFile(join(fixture.workspace, "docs/plan.md"), "utf8"), text);
    await assert.rejects(() => readFile(join(fixture.project, "docs/plan.md")), { code: "ENOENT" });
    const saved = (await fixture.sdk.plans.saves(fixture.sessionId)).saves[0]!;
    assert.equal(saved.status, "completed"); assert.ok(saved.artifactId);
    assert.equal((await fixture.sdk.artifacts.read(saved.artifactId!)).text, text);
    await setup.mockInput.typeText(`/plan info ${saved.id}`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"plan.save-info"');
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().usage.length, 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI explicitly generates, reviews, applies and restores one metered context proposal", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await compactionFixture();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI compaction did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (command: string, expected: string) => {
    await frameUntil("Write a prompt"); await setup.mockInput.typeText(command); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil(expected);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await slash('/compact preview {"keepRecentTurns":1}', '"compaction.preview"');
    assert.equal(fixture.requests.length, 3); setup.mockInput.pressEscape();
    const preview = (await fixture.sdk.compactions.preview(fixture.sessionId, { keepRecentTurns: 1 })).preview;
    await slash(`/compact generate ${JSON.stringify({ digest: preview.digest, modelId: preview.modelId, keepRecentTurns: preview.keepRecentTurns })} confirm-cost`, "requested");
    await fixture.terminal(); setup.mockInput.pressEscape();
    const entry = (await fixture.sdk.compactions.state(fixture.sessionId)).compactions.at(-1)!;
    await slash(`/compact read ${entry.id}`, "Generated summary");
    setup.mockInput.pressKey("END");
    await frameUntil('"status": "proposed"');
    setup.mockInput.pressEscape();
    await slash(`/compact apply ${entry.id} ${entry.revision} confirm-reviewed`, "Reviewed context prefix applied");
    assert.equal(fixture.session().activeCompactionId, entry.id); setup.mockInput.pressEscape();
    const state = await fixture.sdk.compactions.state(fixture.sessionId);
    await slash(`/compact restore ${entry.id} ${state.sourceDigest} confirm-restore`, "Original retained context restored");
    assert.equal(fixture.session().activeCompactionId, null);
    assert.equal(fixture.requests.length, 4);
    assert.equal((await fixture.sdk.budgets.calls({ role: "compaction" })).calls[0]?.reportedTokens, 42);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI queries dated aggregate and retained per-call telemetry without another model request", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ stream: { chunks: ["Generated ", "TUI ", "telemetry."], delayMs: 25 } }), client = await new MoguriClient(fixture.service.connection).ready();
  await fixture.configure(); await fixture.send("Generated TUI telemetry source."); await fixture.terminal();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI telemetry did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText('/dashboard {"range":{"kind":"days","days":7},"bucket":"day"}'); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"budget.dashboard"'); await frameUntil('"reportedTokens": 42');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText('/dashboard calls {"limit":1}'); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"budget.calls"'); await frameUntil('"modelId"');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText('/dashboard operations {"limit":1}'); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"telemetry.operations"'); await frameUntil('"attempts": 0');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/dashboard storage"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"telemetry.storage"'); await frameUntil('"measurement": "key-backed-retained-ciphertext"');
    assert.equal(fixture.requests.length, 1);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI reviews and explicitly refreshes repository metadata without running a model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  let lookups = 0;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { lookups++; return Response.json(generatedRepositoryMetadata()); } } } });
  const client = await new MoguriClient(fixture.service.connection).ready(), git = initializeGeneratedRepository(fixture.project);
  git(["remote", "add", "origin", "https://github.com/generated/example.git"]);
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI repository metadata did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/repository preview"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"repository.preview"'); await frameUntil("https://github.com/generated/example"); assert.equal(lookups, 0);
    const preview = (await client.repositories.preview(fixture.sessionId)).preview;
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/repository refresh ${preview.bindingDigest} ${preview.revision} confirm-lookup`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Metadata refresh"); await waitFor(() => fixture.service.controller.snapshot().repositoryObservations.length === 1);
    await setup.mockInput.typeText("/repository state"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"repository.state"'); await frameUntil('"status": "active"');
    assert.equal(lookups, 1); assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI reads SSH files, changes and plan text without a local opener or model request", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await remoteFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  initializeGeneratedRepository(fixture.workspace);
  await writeFile(join(fixture.workspace, "fixture.txt"), "Generated remote-only TUI file edit.\n");
  await mkdir(join(fixture.workspace, "docs")); await writeFile(join(fixture.workspace, "docs/plan.md"), "Generated remote-only TUI plan.\n");
  await fixture.probe(); await fixture.select();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Remote workspace did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (command: string, expected: string) => {
    await frameUntil("Write a prompt"); await setup.mockInput.typeText(command); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil(expected);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await slash("/file fixture.txt", "Generated remote-only TUI file edit.");
    setup.mockInput.pressEscape();
    await slash("/diff", "+Generated remote-only TUI file edit.");
    setup.mockInput.pressEscape();
    await slash("/plan", "Generated remote-only TUI plan.");
    assert.equal(setup.captureCharFrame().includes("Default-file access is unavailable"), false);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI selects opt-in Single, clears fixed tuning and shows owned routing provenance", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture();
  await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.solverId });
  await fixture.sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 8192 });
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Single did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk }))); await frameUntil("Write a prompt");
    setup.mockInput.pressKey("m", { ctrl: true }); await frameUntil("Moguri Single alpha");
    setup.mockInput.pressArrow("down"); setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().controls.modelId === "kupo"); await frameUntil("Write a prompt");
    assert.equal(fixture.session().controls.modelOptions, undefined); assert.equal(fixture.requests.length, 0);
    await setup.mockInput.typeText("Generated actual terminal Single task."); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await fixture.terminal(); await frameUntil("Generated routed solver answer.");
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "solver"]);
    await setup.mockInput.typeText("/kupo history"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil('"classifierModelId"'); await frameUntil('"completed"');
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI shows solver advice but waits for a different explicit user choice", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ questionRecommendation: { choiceIndex: 1, reason: "Generated Guided comparison favors the second choice." } }), client = await new MoguriClient(fixture.service.connection).ready();
  await client.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI Guided advice did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("generated structured question choices only"); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await frameUntil("Model advises: Generated second choice");
    const question = await waitFor(() => client.getState().snapshot!.questions.find((question) => question.status === "open"));
    assert.equal(question.answer, null); assert.equal(fixture.requests.length, 1);
    setup.mockInput.pressKey("F6"); await frameUntil("Model recommends: Generated second choice"); await frameUntil("Generated Guided comparison");
    setup.mockInput.pressEnter(); await fixture.terminal(); await client.refresh();
    const answered = client.getState().snapshot!.questions.find((value) => value.id === question.id)!;
    assert.equal(answered.answer?.text, question.choices[0]); assert.equal(answered.answer?.actor, "user");
    assert.equal(answered.recommendation?.choice, question.choices[1]); assert.equal(fixture.requests.length, 2);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI creates and renames an isolated profile, flushes old drafts and switches back without rebinding editors", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const fixture = await profileFixture(), first = await fixture.sdk.sessions.create(null, "Generated terminal Default");
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI profiles did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const select = (index: number) => { for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down"); setup.mockInput.pressEnter(); };
  const replaceEditor = async (value: unknown) => { setup.mockInput.pressKey("a", { super: true }); await setup.mockInput.typeText(JSON.stringify(value)); setup.mockInput.pressEnter({ ctrl: true }); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: fixture.sdk })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated private Default draft remains owned.");
    setup.mockInput.pressKey("F8"); await frameUntil("Create isolated profile"); setup.mockInput.pressEnter();
    await frameUntil("Profile metadata only.");
    await replaceEditor({ name: "Generated terminal Beta", color: "#557799" });
    await frameUntil("Create isolated profile");
    await frameUntil("Generated terminal Beta");
    const profile = (await fixture.sdk.profiles.list()).catalog.profiles.find((profile) => profile.name === "Generated terminal Beta")!;
    select(3); await frameUntil("No sessions yet.");
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === first.id)?.draft.text, "Generated private Default draft remains owned.");
    assert.equal(setup.captureCharFrame().includes("Generated private Default draft remains owned."), false);
    setup.mockInput.pressKey("n", { ctrl: true }); await frameUntil("Write a prompt");
    const beta = await fixture.service.profiles.control(profile.id);
    await waitFor(() => beta.snapshot().sessions.length === 1);
    assert.equal(beta.snapshot().sessions[0]?.controls.modelId, null);
    setup.mockInput.pressKey("F8"); await frameUntil("Create isolated profile"); select(1);
    await frameUntil("Profile metadata only.");
    setup.mockInput.pressKey("q", { ctrl: true }); await frameUntil("Save with Ctrl+Enter");
    await replaceEditor({ name: "Generated terminal Beta renamed", color: "#776655" });
    await frameUntil("Create isolated profile");
    await frameUntil("Generated terminal Beta renamed");
    select(2); await frameUntil("Generated private Default draft remains owned.");
    assert.equal(fixture.service.controller.snapshot().sessions.length, 1);
    assert.equal(beta.snapshot().sessions.length, 1);
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual OpenTUI client selects Copilot, streams, stops and receives a second client's draft", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = new MoguriClient(fixture.service.connection);
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (predicate: (frame: string) => boolean) => {
    const deadline = Date.now() + 8000;
    let frame = "";
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.flush();
      frame = setup.captureCharFrame();
      if (predicate(frame)) return frame;
    } while (Date.now() < deadline);
    throw new Error(`TUI did not settle:\n${frame}`);
  };
  try {
    await client.connect();
    await waitFor(() => client.getState().status === "connected");
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil((frame) => frame.includes("Model not set") && frame.includes("Budget Unlimited"));
    setup.mockInput.pressKey("m", { ctrl: true });
    await frameUntil((frame) => frame.includes("Generated Copilot model"));
    setup.mockInput.pressEnter();
    await waitFor(() => fixture.session().controls.modelId === fixture.modelId);
    await frameUntil((frame) => frame.includes(fixture.modelId) && frame.includes("Write a prompt"));
    await setup.mockInput.typeText("generated slow task");
    setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await waitFor(() => fixture.requests.length === 1);
    await frameUntil((frame) => frame.includes("Generated work in progress."));
    setup.mockInput.pressCtrlC();
    assert.equal((await fixture.terminal()).status, "stopped");
    await frameUntil((frame) => frame.includes("stopped"));
    await fixture.service.controller.dispatch(envelope({
      type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "generated draft from desktop", attachments: [],
    }));
    const frame = await frameUntil((frame) => frame.includes("generated draft from desktop"));
    await mkdir(".moguri/artifacts", { recursive: true });
    await writeFile(".moguri/artifacts/tui-session.txt", frame);
  } finally {
    client.disconnect();
    flushSync(() => root.unmount());
    await setup.dispose();
    await fixture.close();
  }
});

test("the actual TUI creates local issues and masks Linear credentials without sending a model turn", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 20)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/issue create bug Generated terminal ticket");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Local project Kanban");
    await frameUntil("Generated terminal ticket");
    assert.equal(fixture.service.controller.snapshot().issues[0]?.kind, "bug");
    setup.mockInput.pressEscape();
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/linear token");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Linear personal API key");
    await setup.mockInput.typeText("generated-linear-masked");
    await frameUntil("********");
    assert.equal(setup.captureCharFrame().includes("generated-linear-masked"), false);
    assert.equal(fixture.session().draft.text.includes("generated-linear-masked"), false);
    setup.mockInput.pressEscape();
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI views, edits and restores the SDK system prompt with an explicit warning", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = new MoguriClient(fixture.service.connection);
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (predicate: (frame: string) => boolean) => {
    const deadline = Date.now() + 8000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 20)); await setup.flush();
      if (predicate(setup.captureCharFrame())) return;
    } while (Date.now() < deadline);
    throw new Error(`TUI settings did not settle:\n${setup.captureCharFrame()}`);
  };
  try {
    await client.ready();
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil((frame) => frame.includes("Budget Unlimited"));
    setup.mockInput.pressKey("g", { ctrl: true });
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    setup.mockInput.pressEnter();
    await frameUntil((frame) => frame.includes("can break tool use") && frame.includes("Ctrl+Enter acknowledges risk"));
    await setup.mockInput.typeText("Generated TUI instruction. ");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    await waitFor(() => fixture.service.controller.snapshot().settings.values.systemPrompt.includes("Generated TUI instruction."));
    setup.mockInput.pressEnter();
    await frameUntil((frame) => frame.includes("Ctrl+Enter acknowledges risk"));
    setup.mockInput.pressKey("r", { ctrl: true });
    await waitFor(() => fixture.service.controller.snapshot().settings.values.systemPrompt === fixture.service.controller.snapshot().settings.defaults.systemPrompt);
    await frameUntil((frame) => frame.includes("Shared Moguri SDK settings"));
    setup.mockInput.pressEscape();
    await frameUntil((frame) => frame.includes("Write a prompt"));
    await setup.mockInput.typeText("/mcp token generated-auth");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil((frame) => frame.includes("MCP credential for generated-auth"));
    await setup.mockInput.typeText("generated-test-secret");
    await frameUntil((frame) => frame.includes("********"));
    assert.equal(setup.captureCharFrame().includes("generated-test-secret"), false);
    assert.equal(fixture.session().draft.text.includes("generated-test-secret"), false);
    setup.mockInput.pressEscape();
    assert.equal(fixture.requests.length, 0);
  } finally {
    client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close();
  }
});

test("the actual TUI holds Cmd/Ctrl+Enter prompts and shares read-only, rename, copy and side commands", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 100, height: 38, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const copied: string[] = [];
  const native = { copy: async (text: string) => { copied.push(text); }, browser: async () => { throw new Error("No external browser in this generated test."); }, file: async () => { throw new Error("No external app in this generated test."); } };
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string) => { await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client, native })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated first held prompt");
    setup.mockInput.pressEnter({ super: true });
    await waitFor(() => fixture.session().queue.length === 1);
    await frameUntil("1 queued");
    await setup.mockInput.typeText("Generated second held prompt");
    setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => fixture.session().queue.length === 2);
    assert.ok(fixture.session().queue.every((item) => item.held));
    assert.equal(fixture.requests.length, 0);
    await slash("/read-only");
    await waitFor(() => fixture.session().mode === "read-only");
    await frameUntil("read-only");
    await slash("/rename Generated terminal name");
    await waitFor(() => fixture.session().title === "Generated terminal name");
    await slash(`/copy ${fixture.session().queue[0]!.id}`);
    await waitFor(() => copied.length === 1);
    assert.deepEqual(copied, ["Generated first held prompt"]);
    await slash("/side");
    const side = await waitFor(() => client.getState().snapshot?.sessions.find((session) => session.kind === "side"));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated held side question");
    setup.mockInput.pressEnter({ super: true });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.queue.length === 1);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.queue[0]?.held, true);
    await slash("/termnial");
    await frameUntil("already a terminal");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI creates Home-backed chats, shows attention and keeps metachat changes separately reviewed without filesystem authority", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 46, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().replace(/│/g, "").replace(/\s+/g, " ").includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  const slash = async (text: string) => { await setup.mockInput.typeText(text); setup.mockInput.pressEnter({ ctrl: true }); };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil("Write a prompt");
    await slash("/new global");
    const session = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.projectId === null));
    await frameUntil("Home (no project)");
    setup.mockInput.pressKey("m", { ctrl: true });
    await frameUntil("Generated Copilot model"); setup.mockInput.pressEnter();
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.controls.modelId === fixture.modelId);
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText("generated question"); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    const question = await waitFor(() => fixture.service.controller.snapshot().attention.find((entry) => entry.sessionId === session.id && entry.active && entry.kind === "question"));
    await frameUntil("Which generated option would you prefer?");
    await slash("/attention"); await frameUntil('"question"');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await slash(`/attention read ${question.id}`);
    await waitFor(() => fixture.service.controller.snapshot().attention.find((entry) => entry.id === question.id)?.acknowledged);
    await slash("/meta generated config proposal");
    const meta = await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.kind === "metachat"));
    await frameUntil("generated config proposal");
    setup.mockInput.pressEnter({ ctrl: true, shift: true });
    const proposal = await waitFor(() => fixture.service.controller.snapshot().configurationProposals.find((entry) => entry.sessionId === meta.id));
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === meta.id)?.status === "completed");
    await frameUntil("Write a prompt");
    await slash(`/config review ${proposal.id}`);
    await frameUntil("Model advice is not user");
    await frameUntil("approval. Applying never");
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    assert.equal(fixture.service.controller.snapshot().settings.values.instructions, "");
    await slash(`/config apply ${proposal.id} ${proposal.contentDigest} acknowledge-risk`);
    await waitFor(() => fixture.service.controller.snapshot().settings.values.instructions.includes("generated headless"));
    assert.equal(fixture.service.controller.snapshot().sessions.find((value) => value.id === meta.id)?.projectId, null);
    assert.equal(JSON.stringify(fixture.requests).includes('"name":"write_file"'), false);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
test("the actual TUI captures explicit typed files and inspects them without pretending clipboard images or calling a model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI context did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    const path = `${fixture.directory}/generated-tui-context.txt`;
    await writeFile(path, "Generated explicit TUI context.");
    flushSync(() => root.render(createElement(TuiApp, { client })));
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/attach-file ${path}`); setup.mockInput.pressEnter({ ctrl: true });
    const attachment = await waitFor(() => fixture.session().draft.attachments[0]);
    assert.equal(attachment.kind, "local_file");
    await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/attached ${attachment.id}`); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Generated explicit TUI context.");
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
test("the actual TUI creates and opens an explicit managed root through shared slash commands", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), git = initializeGeneratedRepository(fixture.project), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI workspace did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/workspace create moguri/generated-tui main"); setup.mockInput.pressEnter({ ctrl: true });
    const workspace = await waitFor(() => fixture.service.controller.snapshot().managedWorkspaces.find((workspace) => workspace.status === "ready"));
    await frameUntil("changeSetId"); setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText(`/workspace new ${workspace.id}`); setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => fixture.service.controller.snapshot().sessions.some((session) => session.workspaceId === workspace.id));
    await frameUntil("Write a prompt");
    await writeFile(`${workspace.path}/fixture.txt`, "Generated TUI worktree content.");
    await setup.mockInput.typeText("/file fixture.txt"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Generated TUI worktree content.");
    assert.equal(git(["branch", "--show-current"]), "main"); assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
test("the actual TUI edits a retained document through shared commands and browses it after session deletion", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 42, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI retained document did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    const folder = await client.projects.folder("Generated TUI artifact folder");
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/artifact new answer Generated TUI retained answer"); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Independent retained document.");
    setup.mockInput.pressKey("a", { super: true });
    await setup.mockInput.typeText(JSON.stringify({ kind: "answer", name: "Generated TUI retained answer", text: "Generated native TUI artifact body.", folderId: folder.id, workItemId: null }, null, 2)); setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Independent retained documents");
    const artifact = await waitFor(() => fixture.service.controller.snapshot().artifacts.find((artifact) => artifact.name === "Generated TUI retained answer"));
    assert.equal((await client.artifacts.read(artifact.id)).text, "Generated native TUI artifact body.");
    assert.equal((await client.artifacts.read(artifact.id)).artifact.folderId, folder.id);
    await client.sessions.delete(fixture.sessionId, true);
    await frameUntil("Generated TUI retained answer");
    assert.equal((await client.artifacts.read(artifact.id)).artifact.originSessionId, fixture.sessionId);
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
test("the actual TUI answers a canonical question through its choices without inventing consent", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture(), client = await new MoguriClient(fixture.service.connection).ready();
  await fixture.configure();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI question did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("generated structured question choices only"); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    const question = await waitFor(() => fixture.service.controller.snapshot().questions.find((question) => question.status === "open"));
    await frameUntil("Your actual answer is needed");
    setup.mockInput.pressKey("F6"); await frameUntil("Actual user question");
    setup.mockInput.pressEnter();
    await waitFor(() => fixture.service.controller.snapshot().questions.find((value) => value.id === question.id)?.answer?.actor === "user");
    await fixture.terminal(); await frameUntil("Write a prompt");
    assert.equal(fixture.service.controller.snapshot().artifacts[0]?.sources.at(-1)?.actor, "user");
    assert.deepEqual(client.settings.get()!.values.permissions.tools, []);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});

test("the actual TUI sets warned estimated caps and opens authoritative cumulative accounting with F7", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }); await fixture.configure();
  const client = await new MoguriClient(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 44, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`TUI budget did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client }))); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("/budget set 50000 - confirm-estimates");
    await frameUntil("Budgets can interrupt");
    setup.mockInput.pressEnter({ ctrl: true });
    await frameUntil("Session estimate-based cap saved.");
    assert.equal(fixture.session().controls.budget.kind, "limited");
    setup.mockInput.pressKey("F7"); await frameUntil('"totals"');
    setup.mockInput.pressKey("\u001b"); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated native finite budget response."); setup.mockInput.pressEnter({ ctrl: true, shift: true });
    await fixture.terminal();
    setup.mockInput.pressKey("F7"); await frameUntil('"knownReportedTokens": 42');
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 1);
  } finally { client.disconnect(); flushSync(() => root.unmount()); await setup.dispose(); await fixture.close(); }
});
