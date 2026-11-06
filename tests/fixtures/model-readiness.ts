import { collectModelReadiness, type ReadinessFileInspection } from "../../apps/service/src/model-readiness.ts";
import type { LocalRuntimeConfiguration, ModelRequirements, MoguriSdk } from "../../packages/sdk/src/index.ts";

export async function configureGeneratedReadiness(sdk: MoguriSdk, fixture: { baseUrl: string; modelId: string }, options: {
  runtime?: LocalRuntimeConfiguration; requirements?: ModelRequirements;
} = {}) {
  const settings = sdk.settings.get();
  if (!settings) throw new Error("Connect the generated profile before configuring readiness.");
  await sdk.settings.update({ ...settings.values, localModels: [{
    id: "generated-readiness", name: "Generated readiness endpoint", enabled: true, auth: "none",
    baseUrl: `${fixture.baseUrl}/v1`, ...(options.runtime ? { runtime: options.runtime } : {}), models: [{
      id: fixture.modelId, name: "Generated readiness model", contextWindow: 16384, maxTokens: 128, imageInput: false,
      ...(options.requirements ? { requirements: options.requirements } : {}),
    }],
  }] }, settings.revision);
  await sdk.models.refresh();
  const model = sdk.models.catalogue().models.flatMap((entry) => entry.offerings)
    .find((entry) => entry.model.providerId === "local.generated-readiness")?.model;
  if (!model) throw new Error("The generated endpoint did not expose its original configured model.");
  return model;
}

function collector(reviewedVersion: boolean): typeof collectModelReadiness {
  return (input, options) => {
  const header = new Uint8Array(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  new DataView(header.buffer).setUint16(18, 62, true);
  const modelHeader = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  return collectModelReadiness(input, {
    ...options,
    probes: {
      target: input.target,
      files: {
        async inspect(path): Promise<ReadinessFileInspection> {
          return path === input.runtime?.executablePath ? {
            status: "observed", code: "file-observed", sizeBytes: 64, sha256: "a".repeat(64),
            identityDigest: "b".repeat(64), header, executionSafe: reviewedVersion,
          } : path === input.runtime?.modelPath ? {
            status: "observed", code: "file-observed", sizeBytes: 1024 ** 3, sha256: null,
            identityDigest: "c".repeat(64), header: modelHeader, executionSafe: false,
          } : {
            status: "missing", code: "file-missing", sizeBytes: null, sha256: null, identityDigest: null,
            header: new Uint8Array(), executionSafe: false,
          };
        },
        async storage() { return { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3, code: "storage-observed" }; },
      },
      async hostFacts() {
        return { operatingSystem: "linux", architecture: "x64", osRelease: "6.18.5",
          ramBytes: 16 * 1024 ** 3, freeRamBytes: 8 * 1024 ** 3, cpuAvailable: true };
      },
      async run(request) {
        request.signal.throwIfAborted();
        if (!reviewedVersion || request.id !== "llama-cpp-version" || request.executablePath !== input.runtime?.executablePath ||
          request.args.length !== 1 || request.args[0] !== "--version") throw new Error("Generated readiness forbids a hardware command, server, model or unreviewed version.");
        return "version: 9911 (abcdef01234567)\n";
      },
    },
  });
  };
}
export const generatedReadinessCollector = collector(false);
export const generatedReviewedReadinessCollector = collector(true);
