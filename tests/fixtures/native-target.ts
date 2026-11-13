import { readFile } from "node:fs/promises";
import { build, transform } from "esbuild";
import { fileURLToPath } from "node:url";
import { isRecord, MoguriError, parse, PROTOCOL_VERSION, SandboxConfigurationSchema, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";
import { distributionConfiguration, readSandboxDistribution } from "../../apps/service/src/sandbox-distribution.ts";

export async function nativeConfiguration(preserveReviewedNetwork = false): Promise<SandboxConfiguration | null> {
  const installation = process.env.MOGURI_NATIVE_INSTALLATION, workload = process.env.MOGURI_NATIVE_WORKLOAD;
  if (!installation && !workload) return null;
  if (!installation || !workload || process.platform !== "darwin" || process.arch !== "arm64") throw new MoguriError("native_fixture", "Set both generated native installation/workload receipts on qualified Apple-silicon macOS.");
  const candidate: unknown = JSON.parse(await readFile(installation, "utf8")), image: unknown = JSON.parse(await readFile(workload, "utf8"));
  if (!isRecord(candidate) || !isRecord(image) || image.status !== "PASS" || !isRecord(image.payload) || image.payload.protocol !== PROTOCOL_VERSION ||
    !isRecord(image.payload.files)) throw new MoguriError("native_fixture", "Use the actual verified installation and current-protocol immutable workload receipt.");
  let resources = { cpus: 2, memoryMb: 2048, diskMb: 2048 };
  if (process.env.MOGURI_SANDBOX_DISTRIBUTION) {
    const definition = await readSandboxDistribution(process.env.MOGURI_SANDBOX_DISTRIBUTION, AbortSignal.timeout(30_000));
    if (definition.distribution.worker.image !== image.image || definition.distribution.worker.workerDigest !== image.payload.files["dist/worker.mjs"] ||
      definition.distribution.worker.bridgeDigest !== image.payload.files["dist/remote-bridge.mjs"]) {
      throw new MoguriError("native_fixture", "The explicitly reviewed distribution differs from this exact workload. No factory resources or image were substituted.");
    }
    resources = distributionConfiguration(definition.distribution).qualification!.resources;
  }
  return parse(SandboxConfigurationSchema, {
    executable: candidate.executable, configPath: null, image: image.image, bundlePath: candidate.bundle, trustRootPath: candidate.key,
    qualification: { release: candidate.version ?? "0.2.3", hostSha256: candidate.hostSha256, keySha256: candidate.keySha256, manifestSha256: candidate.manifestSha256,
      workerDigest: image.payload.files["dist/worker.mjs"], bridgeDigest: image.payload.files["dist/remote-bridge.mjs"],
      trustRootId: candidate.trustRootId, minimumReleaseSequence: candidate.minimumReleaseSequence,
      allowedDomains: preserveReviewedNetwork ? candidate.allowedDomains : [], allowCopilot: preserveReviewedNetwork ? candidate.allowCopilot : false,
      resources },
  });
}
export async function nativeFixtureCommand(modelId: string, baseUrl = "https://api.githubcopilot.com", group = false, scenario?: "decisions" | "finishing" | "steering" | "checkpoint" | "milestone" | "compound",
  behavior?: "hold-decision" | "unknown-checkpoint" | "hold-checkpoint" | "recover-once"): Promise<string[]> {
  const prefix = `globalThis.MOGURI_GENERATED_NATIVE_MODEL=${JSON.stringify(modelId)};globalThis.MOGURI_GENERATED_NATIVE_BASE=${JSON.stringify(baseUrl)};${scenario ? `globalThis.MOGURI_GENERATED_NATIVE_SCENARIO=${JSON.stringify(scenario)};` : ""}${behavior ? `globalThis.MOGURI_GENERATED_NATIVE_BEHAVIOR=${JSON.stringify(behavior)};` : ""}\n`;
  const source = prefix + await readFile(new URL(behavior === "recover-once" ? "./native-retry-provider.mjs" : scenario === "compound" ? "./native-compound-provider.mjs" : scenario === "milestone" ? "./native-milestone-provider.mjs" : scenario === "checkpoint" ? "./native-checkpoint-provider.mjs" : scenario ? "./native-decisions-provider.mjs" :
    group ? "./native-group-provider.mjs" : "./native-provider.mjs", import.meta.url), "utf8");
  const code = (await transform(source, { minify: true, format: "esm", target: "node26" })).code;
  const modules = scenario === "milestone" ? [(await build({
    stdin: { contents: 'import { milestoneResponder } from "./milestone-response.ts"; globalThis.MOGURI_GENERATED_MILESTONE_RESPONDER = milestoneResponder;',
      resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
    bundle: true, write: false, minify: true, format: "esm", platform: "node", target: "node26",
  })).outputFiles[0]!.text, code] : [code];
  const preloads = modules.flatMap((module) => {
    const preload = `data:text/javascript;base64,${Buffer.from(module).toString("base64")}`;
    if (preload.length > 4096) throw new MoguriError("native_fixture", "The generated no-network provider exceeded the existing reviewed argv boundary.");
    return ["--import", preload];
  });
  return ["/usr/local/bin/node", ...preloads, "/opt/moguri/dist/remote-bridge.mjs", "--foreground"];
}
