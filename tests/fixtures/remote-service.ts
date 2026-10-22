import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelope } from "../../apps/service/src/controller.ts";
import { setupFixture, type GeneratedProviderOptions } from "../fixture.ts";
import { createSshTarget } from "./ssh-target.ts";
import type { PlatformOptions } from "../../apps/service/src/platform.ts";

export async function remoteFixture(options: { exposeModels?: boolean; imageInput?: boolean; platform?: PlatformOptions; mcpCall?: GeneratedProviderOptions["mcpCall"]; holdAfterTool?: boolean; readPaste?: GeneratedProviderOptions["readPaste"] } = {}) {
  const secrets = new Map<string, string>(), vault = {
    read: async (id: string) => secrets.get(id) ?? null,
    write: async (id: string, token: string, signal?: AbortSignal) => { signal?.throwIfAborted(); secrets.set(id, token); },
    remove: async (id: string) => { secrets.delete(id); },
  };
  const fixture = await setupFixture({ exposeModels: options.exposeModels ?? true, imageInput: options.imageInput, mcpCall: options.mcpCall, holdAfterTool: options.holdAfterTool, readPaste: options.readPaste,
    platform: { ...options.platform, remote: { ...options.platform?.remote, vault, modelsVault: vault } } });
  const root = await realpath(fixture.directory), sshRoot = join(root, "generated-ssh"), workspace = join(root, "remote-project");
  await mkdir(sshRoot, { mode: 0o700 }); await mkdir(workspace);
  await writeFile(join(workspace, "fixture.txt"), "generated actual remote source\n");
  await writeFile(join(workspace, "AGENTS.md"), "Generated SSH workspace instructions, never a local repository fallback.");
  const ssh = await createSshTarget(sshRoot), controller = fixture.service.controller;
  const settings = structuredClone(controller.snapshot().settings.values); settings.remote = ssh.target;
  await controller.dispatch(envelope({ type: "settings.update", settings, expectedRevision: 0, acknowledgePromptRisk: false }));
  const project = controller.platform.sessions.projects.configuration(fixture.session().projectId);
  await controller.dispatch(envelope({ type: "project.settings", projectId: project.projectId, expectedRevision: project.revision, settings: { ...project.values, remotePath: workspace } }));
  const probe = () => controller.dispatch(envelope({ type: "remote.probe" }));
  const select = async (modelId = fixture.modelId) => controller.dispatch(envelope({ type: "session.configure", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision, controls: { ...fixture.session().controls, env: "Remote", modelId } }));
  return { ...fixture, controller, ssh, workspace, secrets, probe, select, close: async () => { await fixture.service.close(); await ssh.close(); await fixture.close(); } };
}
