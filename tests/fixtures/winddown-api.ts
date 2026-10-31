import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { budgetCharges } from "../../apps/service/src/budgets.ts";
import { digest } from "../../apps/service/src/store.ts";
import { fixtureProvider, waitFor } from "../fixture.ts";
import { routedFixture } from "./single-routing.ts";
import { initializeGeneratedRepository } from "./git-project.ts";
import { defaultKupoSettings, type StoredEvent } from "../../packages/sdk/src/index.ts";
import { envelope } from "../../apps/service/src/controller.ts";
import { generatedKupoProfile } from "./kupo-profiles.ts";

export async function remoteWinddownApiFixture(options: { unknown?: boolean; kupo?: boolean } = {}) {
  const f = await routedFixture({ env: "Remote", configured: false, legacy: false });
  let tightened: Promise<unknown> | undefined;
  const change = (events: StoredEvent[]) => {
    if (tightened || !events.some((event) => event.event_type === "model.completed" && event.session_id === f.sessionId && event.payload.usage.role === "solver")) return;
    const record = f.service.controller.snapshot().winddowns[0]!;
    if (!record) throw new Error("Generated selected-transport finishing hold was not retained.");
    f.solverOptions.omitUsage = options.unknown ?? false;
    tightened = f.service.controller.dispatch(envelope({ type: "budget.policy", expectedRevision: f.service.controller.snapshot().budgetPolicy.revision,
      limit: { basis: "estimate", tokens: 42 + record.step.inputBound + record.step.outputBound }, confirmRisk: true }));
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.winddown = { ...settings.winddown, enabled: true, modelId: f.solverId, outputTokens: 128 };
    settings.kupo = { ...defaultKupoSettings(), approvedModelIds: [f.solverId] };
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    if (options.kupo) {
      const profile = await generatedKupoProfile(f.sdk, f.solverId, { category: "economy", score: 0.4, price: 0 });
      await f.sdk.routing.configure({ ...defaultKupoSettings(), approvedModelIds: [f.solverId], modelProfiles: [profile] }, f.sdk.settings.get()!.revision);
    }
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, env: "Remote", modelId: options.kupo ? "kupo" : f.solverId,
      budget: { kind: "limited", basis: "estimate", tokens: 50_000 } });
    if (options.kupo) await f.sdk.sessions.kupoMode(f.sessionId, "savings");
    f.solverOptions.respond = (request) => JSON.stringify(request.messages).includes("untrustedCheckpointMetadata") ?
      { text: '{"summary":"Generated source-independent SSH finishing data."}' } : !JSON.stringify(request.messages).includes('"role":"tool"') ?
        { tool: { name: "read_file", args: { path: "fixture.txt" } } } : { text: "Generated ordinary answer." };
    return { ...f, run: async () => {
      f.service.controller.on("change", change); await f.send("GENERATED_ORIGINAL_TASK_NOT_FINISHING_CONTEXT");
      await waitFor(() => !f.session().turnId && ["completed", "partial", "failed", "stopped"].includes(f.session().status), 20_000);
      await tightened;
      return f.sdk.winddown.read(f.sdk.winddown.list(f.sessionId)[0]!.id);
    }, close: async () => { f.service.controller.off("change", change); try { await tightened; } finally { await f.close(); } } };
  } catch (error) { await f.close(); throw error; }
}

export async function winddownApiFixture(options: { git?: boolean; capDelta?: number } = {}) {
  const f = await routedFixture(), checkpointOptions = { modelId: "generated-winddown-api", responseMode: "text" as const, exposeModels: true, replyText: JSON.stringify({
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
    settings.notifications = { inApp: settings.notifications.inApp, os: settings.notifications.os, previewContent: settings.notifications.previewContent };
    settings.localModels.push({ id: "generated-winddown", name: "Generated wind-down model", enabled: true, baseUrl: checkpoint.baseUrl + "/v1", auth: "none",
      models: [{ id: checkpoint.modelId, name: "Generated wind-down model", contextWindow: 32768, maxTokens: 128, imageInput: false }] });
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const model = f.sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated wind-down model");
    if (!model) throw new Error("Generated bounded wind-down model is missing.");
    const configured = structuredClone(f.sdk.settings.get()!.values);
    configured.notifications = settings.notifications;
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
