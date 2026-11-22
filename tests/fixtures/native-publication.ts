import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, defaultSettings, type SandboxExecution, type SandboxResult, type SandboxRepository } from "@moguri-dev/sdk";
import { captureNativeSource, captureNativeTree, materializeNativeStage, materializeNativeGroup, nativeRepositoryDirectory } from "@moguri-dev/sdk/testing";
import { digest } from "@moguri-dev/sdk/testing";
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

export async function nativeGroupPublicationFixture(sourceMode?: number) {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), roots = [await realpath(fixture.project), join(await realpath(fixture.directory), "second-repository")];
  await mkdir(roots[1]!, { mode: 0o700 });
  await writeFile(join(roots[1]!, "fixture.txt"), "generated original\n");
  if (sourceMode !== undefined) for (const root of roots) await chmod(join(root, "fixture.txt"), sourceMode);
  const git = roots.map((root) => initializeGeneratedRepository(root));
  const second = await sdk.projects.add(roots[1]!), firstId = fixture.session().projectId;
  assert.ok(firstId);
  const ids = [firstId, second.id!];
  for (const projectId of ids) {
    const { configuration } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, { ...configuration.values,
      repo: { ...configuration.values.repo, workspaceMode: "checkout" } }, configuration.revision);
  }
  const folder = await sdk.projects.group("Generated native publication group", ids.map((projectId) => ({
    projectId, revision: sdk.getState().snapshot?.projectConfigurations.find((configuration) => configuration.projectId === projectId)?.revision ?? 0,
  })));
  const created = await sdk.sessions.createFolder(folder.id!), session = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
  assert.ok(session.repositories); assert.equal(session.repositories.length, 2);
  const sources = await Promise.all(roots.map((root) => captureNativeTree(root, { denied: [], readOnly: [] }, AbortSignal.timeout(10000))));
  const repositories: SandboxRepository[] = session.repositories.map((binding) => {
    const index = ids.indexOf(binding.projectId);
    assert.ok(index >= 0);
    const directory = nativeRepositoryDirectory(binding.projectId);
    return { ...binding, directory, guestRoot: `/workspace/${directory}`, sourceHead: git[index]!(["rev-parse", "HEAD"]) };
  });
  const parent = join(await realpath(fixture.directory), "native-group-fixture-stages"); await mkdir(parent, { mode: 0o700 });
  const id = randomUUID(), stage = await materializeNativeGroup(parent, { profileId: "default", sessionId: session.id, turnId: randomUUID() },
    repositories.map((binding) => ({ projectId: binding.projectId, directory: binding.directory, source: sources[ids.indexOf(binding.projectId)]! })), AbortSignal.timeout(10000));
  const input = { format: "moguri-native-workspace", version: 3, sessionId: session.id, source: null, sourceHead: null, authorityDigest: "a".repeat(64), previousExecutionId: null,
    repositories: repositories.map((binding) => ({ binding: { projectId: binding.projectId, name: binding.name, root: binding.root }, directory: binding.directory,
      source: sources[ids.indexOf(binding.projectId)]!, workingSource: sources[ids.indexOf(binding.projectId)]!, sourceHead: binding.sourceHead })) };
  const inputDigest = fixture.service.store.putBlob(JSON.stringify(input));
  const result: SandboxResult = { format: "moguri-native-result", version: 2, repositories, executionId: id, workspaceId: stage.turnId, inputDigest,
    nativeSessionId: "34".repeat(16), planDigest: "b".repeat(64), signerFingerprint: "c".repeat(64), auditDigest: "d".repeat(64),
    beforeId: "e".repeat(64), afterId: "f".repeat(64), afterBinding: "unique-private-store", rollback: "not-requested", exitCode: 0,
    files: repositories.map((binding, index) => { const text = `Generated native group output ${index}.\n`;
      return { path: `${binding.directory}/fixture.txt`, text, digest: digest(text), bytes: Buffer.byteLength(text), mode: 0o600 }; }),
    deletedPaths: [], excluded: [], excludedCount: 0, journal: { status: "verified", diagnostic: null } };
  const execution: SandboxExecution = { id, profileId: "default", sessionId: session.id, projectId: null, sourceWorkspaceId: null,
    turnId: randomUUID(), workspaceId: stage.turnId, stage, sourceRoot: null, inputDigest, repositories,
    config: defaultSettings().sandbox, configDigest: "a".repeat(64), image: `generated-native@sha256:${"1".repeat(64)}`, workerDigest: "2".repeat(64),
    launchName: `mg-${id.replaceAll("-", "").slice(0, 20)}`, command: ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"],
    createdAt: new Date().toISOString(), root: null, createdAfter: Math.floor(Date.now() / 1000), createdBefore: Math.ceil(Date.now() / 1000) + 120,
    nativeSessionId: result.nativeSessionId, planDigest: result.planDigest, signerFingerprint: result.signerFingerprint, status: "completed", cancellation: "none",
    cleanup: "owned-guest-stopped", diagnostic: "Generated group-publication-only fixture, not VM qualification.", lastSequence: 0, workerPid: null, cliExitCode: 0,
    resultDigest: fixture.service.store.putBlob(JSON.stringify(result)), revision: 0, workerOutcome: "completed" };
  const artifact = fixture.service.controller.platform.artifacts.nativeExecution(session, id, inputDigest);
  fixture.service.store.commit([{ event_type: "artifact.revised", profile_id: "default", payload: { artifact } },
    { event_type: "sandbox.execution_recorded", profile_id: "default", payload: { execution } }]);
  fixture.service.controller.refreshProfile(); await sdk.refresh();
  return { ...fixture, sdk, execution, result, roots, git, repositories, groupSessionId: session.id,
    close: async () => { sdk.disconnect(); await fixture.close(); } };
}
