import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../../apps/service/src/server.ts";
import { MoguriSdk, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "../fixture.ts";
import { nativeFixtureCommand } from "./native-target.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import type { SandboxDns } from "../../apps/service/src/sandbox-network.ts";
import type { IntakeClock } from "../../apps/service/src/session-intake.ts";

export async function nativeApiFixture(configuration: SandboxConfiguration, options: { providerBaseUrl?: string; dns?: SandboxDns; distribution?: string; group?: boolean; intakeClock?: IntakeClock;
  scenario?: "decisions" | "finishing" | "steering" | "checkpoint"; behavior?: "hold-decision" | "unknown-checkpoint" | "hold-checkpoint" | "recover-once" } = {}) {
  assert.ok(configuration.qualification);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-service-")), state = join(root, "state"), project = join(root, "project"), home = join(root, "home");
  for (const path of [state, project, home]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(project, "fixture.txt"), "generated source original\n");
  const provider = await fixtureProvider({ exposeModels: true }), vault = new GeneratedFileVault(join(root, "generated-vault.json"));
  const prepare = provider.provider.prepare.bind(provider.provider);
  const baseUrl = options.providerBaseUrl ?? "https://api.githubcopilot.com";
  provider.provider.prepare = async (id, signal) => {
    const value = await prepare(id, signal);
    return { ...value, model: { ...value.model, baseUrl }, auth: { ...value.auth, baseUrl } };
  };
  let started: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const runtimeOptions = { stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
      platform: { vault, terminal: { defaultRoot: home, vault }, intakeClock: options.intakeClock, sandbox: { vault, command: await nativeFixtureCommand(provider.modelId, baseUrl, options.group, options.scenario, options.behavior),
        dns: options.dns, distribution: options.distribution, setup: { automatic: false } } } };
    const service = await startService(runtimeOptions);
    started = service;
    const sdk = await new MoguriSdk(service.connection).ready();
    const reviewedConfiguration: SandboxConfiguration = { ...configuration,
      qualification: { ...configuration.qualification, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    return { root, state, project, home, provider, service, sdk, runtimeOptions, reviewedConfiguration, close: async (passed: boolean) => {
      sdk.disconnect(); await service.close(); await provider.close();
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
