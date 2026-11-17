import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultKupoSettings, defaultSingleKupoSettings, isRecord, type Controls, type SandboxExecution, type SandboxResult } from "../../packages/sdk/src/index.ts";
import { readNativeCompletion } from "../../apps/service/src/native-evidence.ts";
import { routedFixture } from "./single-routing.ts";
import { generatedKupoProfile } from "./kupo-profiles.ts";
import { milestoneResponder } from "./milestone-response.ts";
import { waitFor } from "../fixture.ts";

export const milestoneAxes = {
  env: ["Local", "Remote", "Sandbox"],
  selection: ["fixed", "automatic-single", "single", "cascade", "critique"],
  autonomy: ["Manual", "Guided", "Autopilot", "Autopilot Max"],
  budget: ["unlimited", "tokens", "usd", "both"],
  window: ["maximum", "half"],
  effort: ["default", "minimal", "low", "medium", "high", "xhigh", "max"],
  input: ["text", "image", "document"],
} as const;

export interface MilestoneCell {
  env: typeof milestoneAxes.env[number];
  selection: typeof milestoneAxes.selection[number];
  autonomy: Controls["autonomy"];
  budget: typeof milestoneAxes.budget[number];
  window: typeof milestoneAxes.window[number];
  effort: typeof milestoneAxes.effort[number];
  input: typeof milestoneAxes.input[number];
}

export const milestoneCellId = (cell: MilestoneCell) =>
  `${cell.env}/${cell.selection}/${cell.autonomy}/${cell.budget}/${cell.window}/${cell.effort}/${cell.input}`;

export function fullMilestoneProduct(): MilestoneCell[] {
  const cells: MilestoneCell[] = [];
  for (const env of milestoneAxes.env)
    for (const selection of milestoneAxes.selection)
      for (const autonomy of milestoneAxes.autonomy)
        for (const budget of milestoneAxes.budget)
          for (const window of milestoneAxes.window)
            for (const effort of milestoneAxes.effort)
              for (const input of milestoneAxes.input)
                cells.push({ env, selection, autonomy, budget, window, effort, input });
  return cells;
}

export const isManualKupoEffort = (cell: Pick<MilestoneCell, "selection" | "effort">) =>
  cell.selection !== "fixed" && cell.effort !== "default";

export const milestoneClientCells = (): MilestoneCell[] => milestoneAxes.env.flatMap((env) => milestoneAxes.selection.map((selection) => ({
  env, selection, autonomy: "Manual", budget: "both", window: "half", effort: selection === "fixed" ? "high" : "default", input: "document",
} as const)));

export const milestoneBudget = (kind: MilestoneCell["budget"]): Controls["budget"] =>
  kind === "unlimited" ? { kind: "unlimited" } : {
    kind: "limited", basis: "estimate",
    ...(kind !== "usd" ? { tokens: 1_000_000 } : {}),
    ...(kind !== "tokens" ? { usd: 10 } : {}),
  };

export type MilestoneFixture = Pick<Awaited<ReturnType<typeof routedFixture>>,
  "sdk" | "service" | "directory" | "project" | "sessionId" | "session" | "modelId" | "solverId" | "options" |
  "solverOptions" | "solver" | "requests" | "workspace" | "close">;

export function milestoneResponses(fixture: MilestoneFixture, cell: MilestoneCell, documentId?: string, question = false) {
  const observed: Array<{ modelId: string; request: Record<string, unknown> }> = [];
  const respond = milestoneResponder({ ...cell, solverId: fixture.solverId, documentId, question });
  fixture.solverOptions.respond = (request) => {
    observed.push({ modelId: fixture.solverId, request });
    return respond(request);
  };
  fixture.options.respond = (request) => {
    observed.push({ modelId: fixture.modelId, request });
    return respond(request);
  };
  return observed;
}

export async function nativeMilestoneWitness(execution: SandboxExecution, result: SandboxResult) {
  assert.equal(execution.status, "completed"); assert.equal(execution.cleanup, "owned-guest-stopped");
  assert.equal(result.executionId, execution.id); assert.equal(result.journal.status, "verified");
  assert.ok(execution.nativeSessionId && execution.planDigest && execution.signerFingerprint);
  assert.equal(result.nativeSessionId, execution.nativeSessionId);
  const evidence = await readNativeCompletion({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: execution.nativeSessionId,
    workspace: execution.stage.workspace, image: execution.image, command: { program: execution.command[0]!, arguments: execution.command.slice(1) },
    createdAfter: execution.createdAfter, createdBefore: execution.createdBefore, planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint });
  for (const key of ["beforeId", "afterId", "auditDigest", "planDigest", "signerFingerprint", "afterBinding", "rollback", "exitCode"] as const) {
    assert.deepEqual(evidence[key], result[key], "Qualification cannot adopt a different original native result.");
  }
  assert.equal(evidence.exitCode, 0);
  const file = await evidence.read("generated-native-matrix.json", 2 * 1024 * 1024);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(file.content), digest: file.digest, bytes: file.content.length,
    auditDigest: evidence.auditDigest, afterId: evidence.afterId };
}

export async function milestoneCalls(fixture: MilestoneFixture, observed: Array<{ modelId: string; request: Record<string, unknown> }>) {
  if (fixture.session().controls.env !== "Sandbox") return observed;
  assert.equal(observed.length, 0); assert.equal(fixture.requests.length + fixture.solver.requests.length, 0);
  const execution = await waitFor(() => fixture.service.controller.snapshot().sandboxExecutions?.find((entry) =>
    entry.sessionId === fixture.sessionId && entry.cleanup === "owned-guest-stopped" && !fixture.service.controller.sandbox.owns(entry.id)), 15000);
  const result = (await fixture.sdk.sandbox.result(execution.id)).result;
  assert.ok(result); assert.equal(result.journal.status, "verified");
  assert.deepEqual(execution.networkScope?.allowedDomains, ["api.githubcopilot.com"]);
  const witness = await nativeMilestoneWitness(execution, result);
  const proof: unknown = JSON.parse(witness.text);
  assert.ok(isRecord(proof) && Array.isArray(proof.calls));
  assert.equal(proof.platform, "linux"); assert.ok(Number.isSafeInteger(proof.uid) && Number(proof.uid) > 0);
  assert.equal(proof.runId, execution.id);
  return proof.calls.map((call) => {
    assert.ok(isRecord(call) && typeof call.modelId === "string" && isRecord(call.request));
    return { modelId: call.modelId, request: call.request };
  });
}

export async function configureMilestoneRouting(fixture: MilestoneFixture, selection: MilestoneCell["selection"]) {
  const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
  const review = await generatedKupoProfile(fixture.sdk, fixture.modelId, {
    category: "standard", score: 0.8, price: selection === "cascade" ? 1 : 0,
  });
  const lineage = selection === "critique" ? (await fixture.sdk.compound.lineageDraft({
    draftModelId: fixture.solverId, criticModelId: fixture.modelId,
    draftLineage: "generated-matrix-alpha", criticLineage: "generated-matrix-beta",
    sourceKind: "reviewed-training-report", sourceUrl: "https://generated-evidence.invalid/milestone-matrix",
    sourceText: "Generated distinct-lineage mechanics, not real training independence or model quality.",
    validUntil: new Date(Date.now() + 3600000).toISOString(), limitations: "Generated mechanical evidence only.",
  })).review : undefined;
  await fixture.sdk.routing.configure(selection === "single" ? {
    ...defaultSingleKupoSettings(), enabled: true, classifierModelId: fixture.modelId,
    approvedModelIds: [fixture.solverId], allowHosted: true,
  } : {
    ...defaultKupoSettings(), classifierModelId: fixture.modelId,
    approvedModelIds: selection === "automatic-single" ? [fixture.solverId] : [fixture.solverId, fixture.modelId],
    modelProfiles: [draft, review], lineageReviews: lineage ? [lineage] : [],
    automaticLimits: { maxEscalations: 1, maxRevisions: 1, maxResultBytes: 1024 },
  }, fixture.sdk.settings.get()!.revision);
  const settings = fixture.sdk.settings.get()!;
  await fixture.sdk.settings.update({
    ...settings.values,
    winddown: { ...settings.values.winddown, enabled: true, modelId: fixture.modelId, allowHosted: true, outputTokens: 32, timeoutMs: 15000 },
    decisions: { ...settings.values.decisions, enabled: true, provider: "bounded-model", modelId: fixture.modelId, allowHosted: true, outputTokens: 128 },
    budgets: { ...settings.values.budgets, rates: [fixture.modelId, fixture.solverId].map((modelId) => ({
      modelId, source: "user-estimate" as const, effectiveAt: new Date().toISOString().slice(0, 10),
      inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    })) },
  }, settings.revision);
}
