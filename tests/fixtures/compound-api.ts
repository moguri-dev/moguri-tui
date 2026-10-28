import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { KUPO_MODEL_ID } from "../../packages/sdk/src/index.ts";
import type { CompoundSettings } from "../../packages/protocol/src/compound.ts";
import { digest } from "../../apps/service/src/store.ts";
import { fixtureProvider, waitFor, type GeneratedProviderOptions } from "../fixture.ts";
import { candidateApiFixture } from "./candidate-api.ts";

export async function compoundApiFixture(configuration: { legacyNotifications?: boolean; legacyCandidateJournal?: boolean } = {}) {
  const routerOptions: GeneratedProviderOptions & { workerPath: string; legacyCandidateJournal?: boolean } = { responseMode: "text", maxOutputTokens: 8192, contextWindow: 262144,
    exposeModels: true, replyText: "Generated pending compound classifier.", workerPath: fileURLToPath(new URL("../../apps/service/src/worker.ts", import.meta.url)),
    ...(configuration.legacyCandidateJournal ? { legacyCandidateJournal: true } : {}) };
  const f = await candidateApiFixture(routerOptions);
  const providers: Array<Awaited<ReturnType<typeof fixtureProvider>>> = [], options: GeneratedProviderOptions[] = [];
  try {
    const proposal = { plan: "Generated plan: replace only the reviewed fixture.", architecture: "Generated architecture: preserve the source and validate in one owned worktree.",
      patch: { kind: "patch" as const, summary: "Generated public candidate.", edits: [{ path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated passing candidate.\n" }] } };
    const settings = structuredClone(f.sdk.settings.get()!.values);
    if (configuration.legacyNotifications) settings.notifications = { inApp: settings.notifications.inApp, os: settings.notifications.os, previewContent: settings.notifications.previewContent };
    for (const role of ["first", "selected", "escalation", "critic"]) {
      const value: GeneratedProviderOptions = { modelId: `generated-compound-${role}-api`, responseMode: "text", replyText: JSON.stringify(proposal), exposeModels: true, maxOutputTokens: 8192, contextWindow: 262144 };
      options.push(value);
      const provider = await fixtureProvider(value); providers.push(provider);
      settings.localModels.push({ id: `generated-compound-${role}`, name: `Generated compound ${role}`, enabled: true, baseUrl: `${provider.baseUrl}/v1`, auth: "none",
        models: [{ id: provider.modelId, name: `Generated compound ${role}`, contextWindow: 262144, maxTokens: 8192, imageInput: false }] });
    }
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const ids = ["first", "selected", "escalation", "critic"].map((role) => {
      const model = f.sdk.getState().snapshot!.provider.models.find((model) => model.name === `Generated compound ${role}`);
      if (!model) throw new Error("Generated compound role model was not discovered.");
      return model.id;
    });
    const policy: CompoundSettings = { enabled: true, workflow: "compound", classifierModelId: f.modelId, approvedModelIds: ids,
      allowHosted: true, minimumConfidence: 0.9, lineageReviews: [], limits: { routerTokens: 512, proposalTokens: 2048, criticTokens: 1024, timeoutMs: 60000 },
      routes: [{ id: "generated-first-route", pattern: "cascade", draftId: ids[0]!, escalationId: ids[2]! },
        { id: "generated-selected-route", pattern: "cascade", draftId: ids[1]!, escalationId: ids[2]! }] };
    const command = `node -e "if(require('node:fs').readFileSync('fixture.txt','utf8')!=='Generated passing candidate.\\n')process.exit(7);console.log('GENERATED_REAL_PROJECT_TEST_PASSED')"`;
    const project = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    await f.sdk.projects.configure(project.projectId, { ...project.values, scripts: [{ id: "generated-validation", name: "Generated real project check", command }] }, project.revision);
    const alternate = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(project.projectId, "moguri/generated-compound-alternate")).id!);
    const input = { sessionId: f.sessionId, draftWorkspaceId: f.workspace.id, alternateWorkspaceId: alternate.id,
      input: { task: "Generated current request: produce and actually validate the fixture change.", files: [{ path: "fixture.txt", baseDigest: digest("generated original\n") }] },
      requestPlan: "Generated user-reviewed task plan.", requestArchitecture: "Generated user-reviewed architecture.",
      validationScriptId: "generated-validation", validationTimeoutMs: 10000 };
    routerOptions.replyText = JSON.stringify({ routeId: "generated-selected-route", pattern: "cascade", draftId: ids[1], escalationId: ids[2],
      confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_SOLVER_CONTEXT" });
    const configure = async () => {
      const current = f.sdk.settings.get()!;
      if (configuration.legacyNotifications) await f.sdk.settings.update({ ...current.values, notifications: settings.notifications, kupo: policy }, current.revision);
      else await f.sdk.routing.configure(policy, current.revision);
      await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: KUPO_MODEL_ID }, undefined, false);
    };
    return { ...f, providers, options, routerOptions, ids, policy, input, proposal, command, alternate, configure,
      source: () => readFile(join(f.project, "fixture.txt"), "utf8"),
      workflow: async (id: string) => waitFor(() => f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id)),
      close: async () => { try { await f.close(); } finally { for (const provider of providers) await provider.close(); } } };
  } catch (error) { try { await f.close(); } finally { for (const provider of providers) await provider.close(); } throw error; }
}
