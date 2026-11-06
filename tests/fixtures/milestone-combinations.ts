import assert from "node:assert/strict";
import { defaultKupoSettings, defaultSingleKupoSettings, isRecord, type Controls } from "../../packages/sdk/src/index.ts";
import { routedFixture } from "./single-routing.ts";
import { generatedKupoProfile } from "./kupo-profiles.ts";

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

export function requiredMilestoneCells(): MilestoneCell[] {
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

export const milestoneBudget = (kind: MilestoneCell["budget"]): Controls["budget"] =>
  kind === "unlimited" ? { kind: "unlimited" } : {
    kind: "limited", basis: "estimate",
    ...(kind !== "usd" ? { tokens: 1_000_000 } : {}),
    ...(kind !== "tokens" ? { usd: 10 } : {}),
  };

export type MilestoneFixture = Awaited<ReturnType<typeof routedFixture>>;

export function milestoneResponses(fixture: MilestoneFixture, cell: MilestoneCell, documentId?: string, question = false) {
  const observed: Array<{ modelId: string; request: Record<string, unknown> }> = [];
  let reviews = 0;
  const solver = (request: Record<string, unknown>) => {
    const messages = request.messages;
    assert.ok(Array.isArray(messages));
    if (question && !messages.some((message) => isRecord(message) && message.role === "tool")) return {
      tool: { name: "ask_user", args: {
        question: "Choose a generated matrix approach?", choices: ["Generated first choice", "Generated second choice"], allowFreeform: false,
        ...(cell.autonomy === "Guided" ? {
          recommendation: { choiceIndex: 1, reason: "Generated selected solver recommendation, not a human answer." },
        } : {}),
      } },
    };
    const hasDocumentResult = messages.some((message) => isRecord(message) && message.role === "tool" &&
      typeof message.content === "string" && message.content.includes("GENERATED_DOCUMENT_SECRET"));
    return documentId && !hasDocumentResult ?
      { tool: { name: "read_document", args: { attachmentId: documentId, section: 2, limit: 512 } } } :
      { text: "Generated selected milestone response." };
  };
  fixture.solverOptions.respond = (request) => {
    observed.push({ modelId: fixture.solverId, request });
    return solver(request);
  };
  fixture.options.respond = (request) => {
    observed.push({ modelId: fixture.modelId, request });
    const messages = request.messages;
    assert.ok(Array.isArray(messages));
    const system = messages.filter(isRecord).find((message) => message.role === "system")?.content;
    assert.equal(typeof system, "string");
    if (String(system).includes("Evaluate only the supplied state and named System One-style questions")) return {
      text: JSON.stringify({ answers: { action: {
        type: "choice", choice: "option1", confidence: 0.98, probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 },
      } } }),
    };
    if (String(system).includes("You classify a Moguri task for an explicitly approved Single workflow")) return {
      text: JSON.stringify({ pattern: "single", modelId: fixture.solverId, confidence: 1,
        reason: "GENERATED_MATRIX_ROUTER_REASON_NOT_SOLVER_CONTEXT" }),
    };
    if (String(system).includes("Choose the least complex eligible Kupo workflow")) return { text: JSON.stringify({
      pattern: cell.selection, modelId: fixture.solverId, complexity: "moderate", taskKind: "substantive", confidence: 1,
      reason: "GENERATED_MATRIX_ROUTER_REASON_NOT_SOLVER_CONTEXT",
      ...(cell.selection === "cascade" ? { escalationId: fixture.modelId } : { criticId: fixture.modelId }),
    }) };
    if (String(system).includes("Review the proposed Kupo response") || String(system).includes("Critique the proposed Kupo response")) {
      reviews++;
      return { text: JSON.stringify({
        verdict: reviews % 2 === 1 ? cell.selection === "cascade" ? "escalate" : "revise" : "pass",
        reason: "Generated untrusted gate advice, never source acceptance or permission.",
      }) };
    }
    return solver(request);
  };
  return observed;
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
