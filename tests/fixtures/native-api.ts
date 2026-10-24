import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../../apps/service/src/server.ts";
import { MoguriSdk, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY } from "../fixture.ts";
import { nativeFixtureCommand } from "./native-target.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import type { SandboxDns } from "../../apps/service/src/sandbox-network.ts";

export async function nativeApiFixture(configuration: SandboxConfiguration, options: { providerBaseUrl?: string; dns?: SandboxDns; distribution?: string } = {}) {
  assert.ok(configuration.qualification);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-service-")), state = join(root, "state"), project = join(root, "project");
  for (const path of [state, project]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(project, "fixture.txt"), "generated source original\n");
  const provider = await fixtureProvider({ exposeModels: true }), vault = new GeneratedFileVault(join(root, "generated-vault.json"));
  const prepare = provider.provider.prepare.bind(provider.provider);
  const baseUrl = options.providerBaseUrl ?? "https://api.githubcopilot.com";
  provider.provider.prepare = async (id, signal) => {
    const value = await prepare(id, signal);
    return { ...value, model: { ...value.model, baseUrl }, auth: { ...value.auth, baseUrl } };
  };
  const service = await startService({ stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
    platform: { vault, sandbox: { vault, command: await nativeFixtureCommand(provider.modelId, baseUrl),
      dns: options.dns, distribution: options.distribution, setup: { automatic: false } } } });
  const sdk = await new MoguriSdk(service.connection).ready();
  const reviewedConfiguration: SandboxConfiguration = { ...configuration,
    qualification: { ...configuration.qualification, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
  return { root, state, project, provider, service, sdk, reviewedConfiguration, close: async (passed: boolean) => {
    sdk.disconnect(); await service.close(); await provider.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated native service diagnostics retained:", root);
  } };
}
