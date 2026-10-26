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
import { defaultBoard, MoguriError } from "../packages/protocol/src/index.ts";

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
    service = await startService({ stateDir, retentionKey: randomBytes(32), provider, platform: {
      integrations: { githubCliRead: async (endpoint, root, signal) => {
        if (!options.runProgram) throw new MoguriError("github_cli_unavailable", "Generated fixture has no authenticated GitHub CLI account.", 403);
        const response = await options.runProgram("gh", ["api", "--hostname", "github.com", "--include", "--method", "GET", endpoint], {
          cwd: root, signal, timeoutMs: 15000, maxBytes: 512 * 1024, label: "Generated GitHub account",
        });
        const normalized = response.replaceAll("\r\n", "\n");
        return JSON.parse(normalized.slice(normalized.indexOf("\n\n") + 2));
      } },
      github: { ...options, runProgram: options.runProgram ?? (async (executable, args, request) => {
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
export async function githubApplicationFixture() {
    const calls: { method: string; path: string }[] = [];
    const repository = { id: 41, name: "fixture", full_name: "generated-owner/fixture",
      owner: { login: "generated-owner", type: "User" }, description: "Generated application repository",
      html_url: "https://github.com/generated-owner/fixture", visibility: "private", private: true, default_branch: "main",
      ssh_url: "git@github.com:generated-owner/fixture.git", clone_url: "https://github.com/generated-owner/fixture.git", license: { spdx_id: "MIT" } };
    let head = "", changedBody = false, issueWrites = 0, prWrites = 0, accountId = 42;
    const issue = (number: number, title = "Generated issue", body = "Generated **issue body**.") => ({ id: number + 100, number, title, body: changedBody ? "Generated changed source." : body, state: "open",
      html_url: `https://github.com/generated-owner/fixture/issues/${number}`, updated_at: "2026-01-01T00:00:00Z", user: { login: "generated-owner" } });
    const pull = (number: number, title = "Generated pull request", body = "Generated **pull request body**.", draft = true) => ({ ...issue(number, title, body),
      html_url: `https://github.com/generated-owner/fixture/pull/${number}`, draft, merged: false,
      base: { ref: "main", sha: head, repo: repository }, head: { ref: "generated-feature", sha: head, repo: repository } });
    const issues = [issue(7)], pulls: ReturnType<typeof pull>[] = [];
    const fixture = await githubServiceFixture({ runProgram: async (executable, args, request) => {
      if (executable !== "gh") return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      const index = args.indexOf("--method"), method = args[index + 1]!, path = args[index + 2]!;
      calls.push({ method, path });
      const fields: Record<string, string> = {};
      for (let index = 0; index < args.length - 1; index++) if (args[index] === "--raw-field" || args[index] === "--field") {
        const value = args[index + 1]!, split = value.indexOf("="); fields[value.slice(0, split)] = value.slice(split + 1);
      }
      let data: unknown;
      if (path === "user") data = { login: "generated-owner", id: accountId };
      else if (path.startsWith("user/repos?")) data = [repository];
      else if (path === "repos/generated-owner/fixture") data = repository;
      else if (path.startsWith("repos/generated-owner/fixture/branches/")) data = { name: decodeURIComponent(path.split("/branches/")[1]!), commit: { sha: head } };
      else if (method === "POST" && path === "repos/generated-owner/fixture/issues") { issueWrites++; const created = issue(20 + issueWrites, fields.title, fields.body); issues.push(created); data = created; }
      else if (method === "POST" && path === "repos/generated-owner/fixture/pulls") { prWrites++; const created = pull(30 + prWrites, fields.title, fields.body, fields.draft === "true"); pulls.push(created); data = created; }
      else if (path.startsWith("repos/generated-owner/fixture/issues?")) data = issues;
      else if (path.startsWith("repos/generated-owner/fixture/pulls?")) data = pulls;
      else if (/^repos\/generated-owner\/fixture\/issues\/\d+$/.test(path)) data = changedBody ? issue(Number(path.split("/").at(-1))) : issues.find((item) => item.number === Number(path.split("/").at(-1)));
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+$/.test(path)) data = pulls.find((item) => item.number === Number(path.split("/").at(-1)));
      else throw new Error(`Unexpected generated GitHub request: ${method} ${path}`);
      return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(data)}`;
    } });
    head = fixture.git(["rev-parse", "HEAD"]); pulls.push(pull(11));
    fixture.git(["remote", "set-url", "origin", repository.ssh_url]);
    fixture.git(["switch", "-c", "generated-feature"]);
    const board = defaultBoard(fixture.projectId);
    await fixture.sdk.issues.configure(fixture.projectId, { ...board, autoRefreshPrs: false }, 0);
    return { ...fixture, calls, repository, changeSource: () => { changedBody = true; }, changeAccount: (id: number) => { accountId = id; }, writes: () => ({ issues: issueWrites, pulls: prWrites }) };
}
