import { defaultKupoSettings, defaultSingleKupoSettings, type Controls } from "../../packages/sdk/src/index.ts";
import { routedFixture } from "./single-routing.ts";
import { generatedKupoProfile } from "./kupo-profiles.ts";
import { milestoneResponder } from "./milestone-response.ts";

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
