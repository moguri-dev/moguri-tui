import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../../apps/service/src/server.ts";
import { MoguriSdk, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, type GeneratedProviderOptions } from "../fixture.ts";
import { nativeFixtureCommand } from "./native-target.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import type { SandboxDns } from "../../apps/service/src/sandbox-network.ts";
import type { IntakeClock } from "../../apps/service/src/session-intake.ts";

// Model HTTP is intercepted; real DNS and proxy access have separate qualification gates.
const generatedModelDns: SandboxDns = { addresses: async () => ["1.1.1.1"], aliases: async () => [] };

export async function nativeApiFixture(configuration: SandboxConfiguration, options: { providerBaseUrl?: string; dns?: SandboxDns; distribution?: string; group?: boolean; intakeClock?: IntakeClock;
  providerOptions?: GeneratedProviderOptions;
  scenario?: "decisions" | "finishing" | "steering" | "checkpoint" | "milestone" | "compound"; behavior?: "hold-decision" | "unknown-checkpoint" | "hold-checkpoint" | "recover-once" } = {}) {
  assert.ok(configuration.qualification);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-service-")), state = join(root, "state"), project = join(root, "project"), home = join(root, "home");
  for (const path of [state, project, home]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(project, "fixture.txt"), "generated source original\n");
  const provider = await fixtureProvider({ exposeModels: true, ...options.providerOptions }), vault = new GeneratedFileVault(join(root, "generated-vault.json"));
  const prepare = provider.provider.prepare.bind(provider.provider);
  const baseUrl = options.providerBaseUrl ?? "https://api.githubcopilot.com";
  provider.provider.prepare = async (id, signal) => {
    const value = await prepare(id, signal);
    return { ...value, model: { ...value.model, baseUrl }, auth: { ...value.auth, baseUrl } };
  };
  let started: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const distribution = options.distribution ?? process.env.MOGURI_SANDBOX_DISTRIBUTION;
    const runtimeOptions = { stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
      platform: { vault, terminal: { defaultRoot: home, vault }, intakeClock: options.intakeClock, sandbox: { vault, command: await nativeFixtureCommand(provider.modelId, baseUrl, options.group, options.scenario, options.behavior),
        dns: options.dns ?? generatedModelDns, distribution, setup: { automatic: false } } } };
    const service = await startService(runtimeOptions);
    started = service;
    const sdk = await new MoguriSdk(service.connection).ready();
    const reviewedConfiguration: SandboxConfiguration = { ...configuration,
      qualification: { ...configuration.qualification, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    const qualify = async () => {
      assert.ok(distribution, "Native managed qualification requires its explicit reviewed distribution.");
      const review = (await sdk.sandbox.setup.review()).review;
      assert.equal(review.administratorRequired, false, "Generated qualification must reuse verified installed release files, never request an OS dialog.");
      const admitted = await sdk.sandbox.setup.apply(review), outcome = await sdk.sandbox.setup.wait(admitted.id!);
      assert.equal(outcome.operation.status, "completed", outcome.operation.diagnostic ?? "The original managed setup did not complete.");
      await sdk.refresh();
      assert.equal(sdk.getState().snapshot?.capabilities.find((capability) => capability.env === "Sandbox")?.ready, true);
      return outcome;
    };
    return { root, state, project, home, provider, service, sdk, runtimeOptions, reviewedConfiguration, qualify, close: async (passed: boolean) => {
      sdk.disconnect();
      const cleanup = await Promise.allSettled([service.close(), provider.close()]);
      const failures = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (failures.length) {
        console.error("Generated native cleanup diagnostics retained:", root);
        throw new AggregateError(failures, `Original native cleanup is unconfirmed; retained ${root}.`);
      }
      if (passed) await rm(root, { recursive: true, force: true });
      else console.error("Generated native service diagnostics retained:", root);
    } };
  } catch (error) {
    const cleanup = await Promise.allSettled([started?.close(), provider.close()]);
    const failures = cleanup.filter((result) => result.status === "rejected").map((result): unknown => result.reason);
    console.error("Generated native setup diagnostics retained:", root);
    if (failures.length) throw new AggregateError([error, ...failures], "Generated native setup and owned cleanup failed.");
    throw error;
  }
}
