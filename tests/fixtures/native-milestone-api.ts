import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSandboxManagement, isRecord, PROTOCOL_VERSION, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";
import { readSandboxDistribution } from "../../apps/service/src/sandbox-distribution.ts";
import { fixtureProvider, type GeneratedProviderOptions } from "../fixture.ts";
import { nativeApiFixture } from "./native-api.ts";
import type { MilestoneFixture } from "./milestone-combinations.ts";

export async function nativeMilestoneFixture(configuration: SandboxConfiguration, scenario: "milestone" | "compound" = "milestone"): Promise<MilestoneFixture & { state: string; nativeRoot: string }> {
  const workloadPath = process.env.MOGURI_NATIVE_WORKLOAD, distributionPath = process.env.MOGURI_SANDBOX_DISTRIBUTION;
  assert.ok(workloadPath && distributionPath && configuration.qualification);
  const workload: unknown = JSON.parse(await readFile(workloadPath, "utf8"));
  assert.ok(isRecord(workload) && workload.status === "PASS" && isRecord(workload.payload) && isRecord(workload.payload.files));
  assert.equal(workload.payload.protocol, PROTOCOL_VERSION);
  const definition = await readSandboxDistribution(distributionPath, AbortSignal.timeout(30000));
  assert.equal(workload.image, configuration.image);
  assert.equal(definition.distribution.worker.image, workload.image);
  const paths = ["package.json", "package-lock.json", "dist/worker.mjs", "dist/remote-bridge.mjs", "dist/mcp-worker.mjs",
    "dist/data-worker.mjs", "dist/cacache.cjs", "dist/cacache.mjs", "dist/cache-NOTICES.txt"];
  assert.deepEqual(Object.keys(workload.payload.files).sort(), [...paths].sort());
  const actual: Record<string, string> = {};
  for (const path of [...paths, "scripts/worker-image/Containerfile"]) {
    actual[path] = createHash("sha256").update(await readFile(path)).digest("hex");
    assert.equal(actual[path], path === "scripts/worker-image/Containerfile" ? workload.payload.recipeDigest : workload.payload.files[path],
      `The physical milestone fixture cannot use stale payload bytes: ${path}`);
  }
  assert.equal(createHash("sha256").update(JSON.stringify(actual)).digest("hex"), definition.distribution.worker.payloadDigest);
  const capabilities = { maxOutputTokens: scenario === "compound" ? 8192 : 128, reasoning: true, contextWindow: scenario === "compound" ? 262144 : 32768,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" }, imageInput: true, toolInput: true, exposeModels: true } as const;
  const options: GeneratedProviderOptions = { ...capabilities, modelId: "generated-native-matrix-reviewer" };
  const solverOptions: GeneratedProviderOptions = { ...capabilities, modelId: "generated-routed-solver-api" };
  const fixture = await nativeApiFixture(configuration, { scenario, providerOptions: options });
  const { sdk, service } = fixture;
  let ownedSolver: Awaited<ReturnType<typeof fixtureProvider>> | undefined, ownedDirectory: string | undefined;
  const close = async () => {
    try { await fixture.close(false); }
    finally { try { await ownedSolver?.close(); } finally { if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true }); } }
  };
  try {
    const solver = ownedSolver = await fixtureProvider(solverOptions);
    const directory = ownedDirectory = await mkdtemp(join(tmpdir(), "moguri-native-matrix-input-"));
    await writeFile(join(fixture.project, "fixture.txt"), "generated original\n");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, sandbox: fixture.reviewedConfiguration,
      sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false } }, settings.revision);
    await fixture.qualify();
    const original = fixture.provider.provider.prepare.bind(fixture.provider.provider);
    fixture.provider.provider.state = { ...fixture.provider.provider.state,
      models: [...fixture.provider.provider.state.models, ...solver.provider.state.models] };
    fixture.provider.provider.prepare = async (id, signal) => {
      if (id !== solver.modelId) return original(id, signal);
      const prepared = await solver.provider.prepare(id, signal), baseUrl = "https://api.githubcopilot.com";
      return { ...prepared, model: { ...prepared.model, baseUrl }, auth: { ...prepared.auth, baseUrl } };
    };
    await sdk.models.refresh();
    const project = await sdk.projects.add(fixture.project);
    const created = await sdk.sessions.create(project.id!, "Generated native matrix owner", { env: "Sandbox", modelId: solver.modelId });
    const sessionId = created.id!;
    const session = () => {
      const value = service.controller.snapshot().sessions.find((value) => value.id === sessionId);
      assert.ok(value?.projectId);
      return { ...value, projectId: value.projectId };
    };
    return { sdk, service, directory, nativeRoot: fixture.root, state: fixture.state, project: fixture.project, sessionId, session,
      modelId: fixture.provider.modelId, solverId: solver.modelId, options, solverOptions, solver, requests: fixture.provider.requests,
      workspace: null, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native matrix setup and exact owned cleanup failed."); }
    throw error;
  }
}
