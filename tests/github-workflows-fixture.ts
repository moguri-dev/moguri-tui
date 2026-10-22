import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { runProgram } from "../apps/service/src/program.ts";
import type { GitHubWorkflowOptions } from "../apps/service/src/github-workflows.ts";
import type { ProviderAdapter } from "../apps/service/src/provider.ts";
import type { GithubScope } from "../packages/protocol/src/github-workflows.ts";

export async function connectGithubSdk(sdk: MoguriSdk): Promise<void> {
  await sdk.connect();
  const deadline = Date.now() + 5000;
  while (sdk.getState().status !== "connected") {
    if (Date.now() >= deadline) throw new Error("Generated SDK did not authenticate its loopback event stream.");
    await delay(10);
  }
}
export async function githubServiceFixture(options: GitHubWorkflowOptions = {}) {
  const parent = resolve(".moguri", "qualification");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(parent, `generated-github-service-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const root = join(directory, "checkout"), remote = join(directory, "remote.git"), hooks = join(directory, "hooks"), stateDir = join(directory, "state");
  await mkdir(root); await mkdir(hooks);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const invoke = (cwd: string, args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const git = (args: string[]) => invoke(root, args), bare = (args: string[]) => invoke(remote, args);
  invoke(directory, ["init", "--bare", "--initial-branch=main", remote]); git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Generated Workflow Service"]); git(["config", "user.email", "generated@example.invalid"]);
  git(["config", "commit.gpgSign", "false"]); git(["config", "tag.gpgSign", "false"]); git(["config", "core.hooksPath", hooks]);
  bare(["config", "core.hooksPath", hooks]); await writeFile(join(root, "fixture.txt"), "generated base\n");
  git(["add", "--", "fixture.txt"]); git(["commit", "--no-gpg-sign", "-m", "Generated base"]); git(["remote", "add", "origin", remote]); git(["push", "origin", "main"]);
  const provider: ProviderAdapter = {
    state: { status: "disconnected", models: [], login: null, diagnostic: "Generated offline Git-only fixture" }, onChange: () => {},
    refresh: async () => {}, login: () => { throw new Error("Generated fixture forbids personal authorization."); }, cancel: async () => {}, logout: async () => {},
    prepare: async () => { throw new Error("Generated fixture forbids inference."); },
  };
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    service = await startService({ stateDir, retentionKey: randomBytes(32), provider, platform: { github: { ...options, runProgram: options.runProgram ?? (async (executable, args, request) => {
      if (executable !== "git") throw new Error("Generated fixture forbids real GitHub requests.");
      return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    }) } } });
    sdk = new MoguriSdk(service.connection); await connectGithubSdk(sdk);
    const projectId = (await sdk.command({ type: "project.add", path: root })).id!;
    const sessionId = (await sdk.sessions.create(projectId, "Generated GitHub workflow")).id!;
    const scope: GithubScope = { env: "Local", projectId, sessionId };
    const session = () => sdk!.getState().snapshot!.sessions.find((value) => value.id === sessionId)!;
    return { directory, root, remote, hooks, stateDir, service, sdk, scope, projectId, sessionId, session, git, bare,
      close: async () => { sdk!.disconnect(); await service!.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    sdk?.disconnect(); await service?.close(); await rm(directory, { recursive: true, force: true }); throw error;
  }
}
