import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, KUPO_MODEL_ID } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, setupFixture, waitFor, type GeneratedProviderOptions } from "../fixture.ts";
import type { PlatformOptions } from "../../apps/service/src/platform.ts";
import { createSshTarget } from "./ssh-target.ts";
import { fileURLToPath } from "node:url";
import { appendLegacyKupoSelection } from "./legacy-state.ts";

export async function routedFixture(configuration: { env?: "Local" | "Remote"; configured?: boolean; platform?: PlatformOptions; legacy?: boolean } = {}) {
  const remote = configuration.env === "Remote";
  const secrets = new Map<string, string>(), vault = { read: async (id: string) => secrets.get(id) ?? null, write: async (id: string, value: string) => { secrets.set(id, value); }, remove: async (id: string) => { secrets.delete(id); } };
  const options: GeneratedProviderOptions & { platform?: PlatformOptions; workerPath?: string } = { maxOutputTokens: 128, exposeModels: true, responseMode: "text", platform: { ...configuration.platform, remote: { ...configuration.platform?.remote, vault, modelsVault: vault } } };
  const solverOptions: GeneratedProviderOptions = { modelId: "generated-routed-solver-api", maxOutputTokens: 128, exposeModels: true, replyText: "Generated routed solver answer." };
  if (!remote && configuration.legacy !== false) options.workerPath = fileURLToPath(new URL("./legacy-worker-83.ts", import.meta.url));
  const fixture = await setupFixture(options), solver = await fixtureProvider(solverOptions);
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let ssh: Awaited<ReturnType<typeof createSshTarget>> | undefined, workspace: string | null = null;
  const close = async () => {
    try {
      if (remote) {
        if (fixture.session().turnId) { await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal(); }
        await waitFor(() => fixture.service.controller.snapshot().executions.every((execution) => !fixture.service.controller.remote.owns(execution.id)));
      }
    } finally {
      sdk.disconnect();
      try { await fixture.service.close(); } finally { try { await ssh?.close(); } finally { try { await fixture.close(); } finally { await solver.close(); } } }
    }
  };
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    // Shared routing fixtures also generate genuine pre-sound recovery histories.
    settings.notifications = { inApp: settings.notifications.inApp, os: settings.notifications.os, previewContent: settings.notifications.previewContent };
    const endpoint = { id: "generated-routed-solver", name: "Generated routed solver", enabled: true, baseUrl: `${solver.baseUrl}/v1`, auth: "none" as const,
      models: [{ id: solver.modelId, name: "Generated routed solver", contextWindow: 16384, maxTokens: 128, imageInput: false }] };
    if (remote) {
      const root = await realpath(fixture.directory), targetRoot = join(root, "generated-routing-ssh"); workspace = join(root, "generated-routing-remote");
      await mkdir(targetRoot); await mkdir(workspace); await writeFile(join(workspace, "fixture.txt"), "Generated actual routed SSH source.\n");
      ssh = await createSshTarget(targetRoot); settings.remote = { ...ssh.target, models: [endpoint] };
    } else settings.localModels = [endpoint];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    if (remote) {
      await sdk.remote.probe();
      const project = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
      await sdk.projects.configure(project.projectId, { ...project.values, remotePath: workspace }, project.revision);
    }
    await sdk.models.refresh();
    const model = sdk.getState().snapshot!.provider.models.find((model) => model.source === "local" && Boolean(model.id.startsWith("remote.")) === remote);
    if (!model) throw new Error("The generated routed solver was not discovered in its explicit environment.");
    const configured = structuredClone(sdk.settings.get()!.values);
    configured.notifications = settings.notifications;
    configured.kupo = { enabled: true, workflow: "single", classifierModelId: fixture.modelId, approvedModelIds: [model.id], allowHosted: true, minimumConfidence: 0.9 };
    options.replyText = JSON.stringify({ pattern: "single", modelId: model.id, confidence: 0.95, reason: "Generated classifier advice, never user instructions or permissions." });
    if (configuration.configured !== false) await sdk.settings.update(configured, sdk.settings.get()!.revision);
    return { ...fixture, sdk, solver, options, solverOptions, solverId: model.id, workspace,
      select: () => configuration.legacy !== false && sdk.settings.get()?.values.kupo.workflow !== "single" ? appendLegacyKupoSelection(sdk, fixture.service.controller, fixture.sessionId, remote ? "Remote" : "Local") :
        sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: remote ? "Remote" : "Local", modelId: KUPO_MODEL_ID }, undefined, false),
      close };
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated routed fixture setup and cleanup failed."); } throw error; }
}
