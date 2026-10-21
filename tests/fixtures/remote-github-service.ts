import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { remoteFixture } from "./remote-service.ts";
import { forbidControllerGithub, generatedRemoteGithub } from "./remote-github.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

export async function remoteGithubFixture(options: { exposeModels?: boolean } = {}) {
  const f = await remoteFixture({ exposeModels: options.exposeModels ?? false, platform: { integrations: { fetch: async () => { throw new Error("Generated control-plane GitHub fallback must not run"); } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const controllerGithub = await forbidControllerGithub(f.directory);
  try {
    const github = await generatedRemoteGithub(f.directory, f.ssh.target);
    const settings = structuredClone(sdk.settings.get()!.values); settings.remote = github.target;
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const config = (await sdk.projects.configuration(f.session().projectId)).configuration;
    await sdk.projects.configure(config.projectId, { ...config.values, repo: { ...config.values.repo, githubAccess: "gh-cli" } }, config.revision);
    initializeGeneratedRepository(f.project)(["remote", "add", "origin", "https://github.com/generated/host.git"]);
    initializeGeneratedRepository(f.workspace)(["remote", "add", "origin", "https://github.com/generated/example.git"]);
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    return { ...f, sdk, github, controllerGithub, close: async () => { try { sdk.disconnect(); await f.close(); } finally { controllerGithub.restore(); } } };
  } catch (error) { try { sdk.disconnect(); await f.close(); } finally { controllerGithub.restore(); } throw error; }
}
