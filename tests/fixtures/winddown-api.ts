import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { budgetCharges } from "../../apps/service/src/budgets.ts";
import { digest } from "../../apps/service/src/store.ts";
import { fixtureProvider } from "../fixture.ts";
import { routedFixture } from "./single-routing.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

export async function winddownApiFixture(options: { git?: boolean; capDelta?: number } = {}) {
  const f = await routedFixture(), checkpointOptions = { responseMode: "text" as const, exposeModels: true, replyText: JSON.stringify({
    summary: "Generated wind-down: ordinary work was blocked by the actual cumulative cap. No code was accepted or committed.",
  }) }, checkpoint = await fixtureProvider(checkpointOptions);
  let git: ReturnType<typeof initializeGeneratedRepository> | undefined;
  const originalPrepare = f.service.controller.provider.prepare.bind(f.service.controller.provider); let cap: number | null = null;
  try {
    if (options.git) {
      git = initializeGeneratedRepository(f.project);
      git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    }
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.localModels.push({ id: "generated-winddown", name: "Generated wind-down model", enabled: true, baseUrl: checkpoint.baseUrl + "/v1", auth: "none",
      models: [{ id: checkpoint.modelId, name: "Generated wind-down model", contextWindow: 32768, maxTokens: 128, imageInput: false }] });
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const model = f.sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated wind-down model");
    if (!model) throw new Error("Generated bounded wind-down model is missing.");
    const configured = structuredClone(f.sdk.settings.get()!.values);
    configured.winddown = { enabled: true, modelId: model.id, allowHosted: false, outputTokens: 64, timeoutMs: 10000 };
    await f.sdk.settings.update(configured, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 1000000 } });
    await f.select();
    f.service.controller.provider.prepare = async (id, signal) => {
      const prepared = await originalPrepare(id, signal);
      if (id === f.solverId) {
        const state = f.service.controller.snapshot(), charged = budgetCharges(state.budgetEntries, state.budgetPlans).tokens;
        if (charged === null || !state.budgetPlans.some((plan) => plan.role === "checkpoint" && plan.status === "held")) throw new Error("Generated exact cap needs its complete already-held checkpoint envelope.");
        cap = charged + (options.capDelta ?? 0);
        await f.sdk.budgets.policy({ basis: "estimate", tokens: cap }, state.budgetPolicy.revision, true);
      }
      return prepared;
    };
    const run = async () => {
      await f.send("Generated finite routed request with reserved final checkpoint."); await f.terminal(); await f.sdk.refresh();
      const record = f.sdk.winddown.list(f.sessionId)[0]; if (!record) throw new Error("Generated wind-down lost its independently retained owner.");
      return f.sdk.winddown.read(record.id);
    };
    const accept = async () => {
      if (!git) throw new Error("Choose the generated Git fixture before accepted-source checkpointing.");
      const created = await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-winddown-acceptance"), stage = await f.sdk.workspaces.wait(created.id!);
      const original = await readFile(join(f.project, "fixture.txt"), "utf8");
      const patch = { kind: "patch" as const, summary: "Generated actual-user accepted checkpoint input.", edits: [{ path: "fixture.txt", baseDigest: digest(original), text: "Generated independently accepted checkpoint bytes.\n" }] };
      const preview = (await f.sdk.candidates.preview(f.sessionId, stage.id, patch)).preview;
      const candidate = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, stage.id, patch, preview.digest)).id!);
      const application = (await f.sdk.candidates.applyPreview(candidate.candidate.id, f.sessionId)).preview;
      await f.sdk.candidates.apply(candidate.candidate.id, f.sessionId, application.revision, application.digest);
      return f.sdk.candidates.wait(candidate.candidate.id);
    };
    return { ...f, checkpoint, checkpointOptions, checkpointModelId: model.id, git, cap: () => cap, run, accept,
      unrelated: async () => {
        if (!git) throw new Error("Choose the generated Git fixture before unrelated index edits.");
        await writeFile(join(f.project, "generated-unrelated.txt"), "Generated unrelated staged work.\n"); git(["add", "--", "generated-unrelated.txt"]);
      },
      close: async () => { f.service.controller.provider.prepare = originalPrepare; await f.close(); await checkpoint.close(); } };
  } catch (error) { await f.close(); await checkpoint.close(); throw error; }
}
