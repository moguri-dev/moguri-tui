import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, defaultSettings, type SandboxExecution, type SandboxResult } from "../../packages/sdk/src/index.ts";
import { captureNativeSource, materializeNativeStage } from "../../apps/service/src/native-staging.ts";
import { digest } from "../../apps/service/src/store.ts";
import { setupFixture } from "../fixture.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

export async function nativePublicationFixture() {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const root = await realpath(fixture.project), git = initializeGeneratedRepository(root);
  await writeFile(join(root, "second.txt"), "Generated second original.\n");
  const source = await captureNativeSource(root, ["fixture.txt", "second.txt"], { denied: [], readOnly: [] }, AbortSignal.timeout(5000));
  const parent = join(await realpath(fixture.directory), "native-fixture-stages"); await mkdir(parent, { mode: 0o700 });
  const id = randomUUID(), stage = await materializeNativeStage(parent, { profileId: "default", sessionId: fixture.sessionId, turnId: randomUUID() }, source, AbortSignal.timeout(5000));
  const input = { format: "moguri-native-workspace", version: 1, sessionId: fixture.sessionId, source, authorityDigest: "a".repeat(64), sourceHead: git(["rev-parse", "HEAD"]) };
  const inputDigest = fixture.service.store.putBlob(JSON.stringify(input)), now = new Date().toISOString();
  const result: SandboxResult = { format: "moguri-native-result", version: 1, executionId: id, workspaceId: stage.turnId, inputDigest,
    nativeSessionId: "12".repeat(16), planDigest: "b".repeat(64), signerFingerprint: "c".repeat(64), auditDigest: "d".repeat(64),
    beforeId: "e".repeat(64), afterId: "f".repeat(64), afterBinding: "unique-private-store", rollback: "not-requested", exitCode: 0,
    files: [{ path: "fixture.txt", text: "Generated first native output.\n" }, { path: "second.txt", text: "Generated second native output.\n" }]
      .map((file) => ({ ...file, digest: digest(file.text), bytes: Buffer.byteLength(file.text), mode: 0o600 })),
    deletedPaths: [], excluded: [], excludedCount: 0, journal: { status: "verified", diagnostic: null } };
  const execution: SandboxExecution = { id, profileId: "default", sessionId: fixture.sessionId, projectId: fixture.session().projectId,
    sourceWorkspaceId: null, turnId: randomUUID(), workspaceId: stage.turnId, stage, sourceRoot: root, inputDigest,
    config: defaultSettings().sandbox, configDigest: "a".repeat(64), image: `generated-native@sha256:${"1".repeat(64)}`, workerDigest: "2".repeat(64),
    launchName: `mg-${id.replaceAll("-", "").slice(0, 20)}`, command: ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"],
    createdAt: now, root: "/workspace", createdAfter: Math.floor(Date.now() / 1000), createdBefore: Math.ceil(Date.now() / 1000) + 120,
    nativeSessionId: result.nativeSessionId, planDigest: result.planDigest, signerFingerprint: result.signerFingerprint,
    status: "completed", cancellation: "none", cleanup: "owned-guest-stopped", diagnostic: "Generated publication-only fixture, not VM qualification.",
    lastSequence: 0, workerPid: null, cliExitCode: 0, resultDigest: fixture.service.store.putBlob(JSON.stringify(result)), revision: 0, workerOutcome: "completed" };
  const artifact = fixture.service.controller.platform.artifacts.nativeExecution(fixture.session(), id, inputDigest);
  fixture.service.store.commit([{ event_type: "artifact.revised", profile_id: "default", project_id: execution.projectId, payload: { artifact } },
    { event_type: "sandbox.execution_recorded", profile_id: "default", project_id: execution.projectId, payload: { execution } }]);
  fixture.service.controller.refreshProfile(); await sdk.refresh();
  return { ...fixture, sdk, execution, result, root, git, close: async () => { sdk.disconnect(); await fixture.close(); } };
}
