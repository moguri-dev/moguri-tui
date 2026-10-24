import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { isRecord, MoguriError, parse, PROTOCOL_VERSION, SandboxConfigurationSchema, type SandboxConfiguration } from "../../packages/sdk/src/index.ts";

export async function nativeConfiguration(): Promise<SandboxConfiguration | null> {
  const installation = process.env.MOGURI_NATIVE_INSTALLATION, workload = process.env.MOGURI_NATIVE_WORKLOAD;
  if (!installation && !workload) return null;
  if (!installation || !workload || process.platform !== "darwin" || process.arch !== "arm64") throw new MoguriError("native_fixture", "Set both generated native installation/workload receipts on qualified Apple-silicon macOS.");
  const candidate: unknown = JSON.parse(await readFile(installation, "utf8")), image: unknown = JSON.parse(await readFile(workload, "utf8"));
  if (!isRecord(candidate) || !isRecord(image) || image.status !== "PASS" || !isRecord(image.payload) || image.payload.protocol !== PROTOCOL_VERSION ||
    !isRecord(image.payload.files)) throw new MoguriError("native_fixture", "Use the actual verified installation and current-protocol immutable workload receipt.");
  return parse(SandboxConfigurationSchema, {
    executable: candidate.executable, configPath: null, image: image.image, bundlePath: candidate.bundle, trustRootPath: candidate.key,
    qualification: { release: "0.2.3", hostSha256: candidate.hostSha256, keySha256: candidate.keySha256, manifestSha256: candidate.manifestSha256,
      workerDigest: image.payload.files["dist/worker.mjs"], bridgeDigest: image.payload.files["dist/remote-bridge.mjs"],
      trustRootId: candidate.trustRootId, minimumReleaseSequence: candidate.minimumReleaseSequence, allowedDomains: [], allowCopilot: false,
      resources: { cpus: 2, memoryMb: 2048, diskMb: 2048 } },
  });
}
export async function nativeFixtureCommand(modelId: string, baseUrl = "https://api.githubcopilot.com"): Promise<string[]> {
  const source = `globalThis.MOGURI_GENERATED_NATIVE_MODEL=${JSON.stringify(modelId)};globalThis.MOGURI_GENERATED_NATIVE_BASE=${JSON.stringify(baseUrl)};\n${await readFile(new URL("./native-provider.mjs", import.meta.url), "utf8")}`;
  const { code } = await transform(source, { minify: true, format: "esm", target: "node26" });
  const preload = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  if (preload.length > 4096) throw new MoguriError("native_fixture", "The generated no-network provider exceeded the existing reviewed argv boundary.");
  return ["/usr/local/bin/node", "--import", preload, "/opt/moguri/dist/remote-bridge.mjs", "--foreground"];
}
