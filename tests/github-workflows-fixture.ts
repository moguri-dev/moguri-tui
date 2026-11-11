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
import type { IntegrationOptions } from "../apps/service/src/project-integrations.ts";
import type { GithubScope } from "../packages/protocol/src/github-workflows.ts";
import { defaultBoard, MoguriError } from "../packages/protocol/src/index.ts";
import { generatedNodeSupervision } from "./fixture.ts";
import { appendLegacyProjectSession } from "./fixtures/legacy-state.ts";

export async function connectGithubSdk(sdk: MoguriSdk): Promise<void> {
  await sdk.connect();
  const deadline = Date.now() + 5000;
  while (sdk.getState().status !== "connected") {
    if (Date.now() >= deadline) throw new Error("Generated SDK did not authenticate its loopback event stream.");
    await delay(10);
  }
}
export async function githubServiceFixture(options: GitHubWorkflowOptions = {}, configuredProvider?: ProviderAdapter, retentionKey: Buffer = randomBytes(32), integrations: IntegrationOptions = {}) {
  const parent = resolve(".moguri", "qualification");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(parent, `generated-github-service-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const root = join(directory, "checkout"), remote = join(directory, "remote.git"), hooks = join(directory, "hooks"), stateDir = join(directory, "state"), home = join(directory, "home");
  await mkdir(root); await mkdir(hooks); await mkdir(home);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const invoke = (cwd: string, args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const git = (args: string[]) => invoke(root, args), bare = (args: string[]) => invoke(remote, args);
  invoke(directory, ["init", "--bare", "--initial-branch=main", remote]); git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Generated Workflow Service"]); git(["config", "user.email", "generated@example.invalid"]);
  git(["config", "commit.gpgSign", "false"]); git(["config", "tag.gpgSign", "false"]); git(["config", "core.hooksPath", hooks]);
  bare(["config", "core.hooksPath", hooks]); await writeFile(join(root, "fixture.txt"), "generated base\n");
  git(["add", "--", "fixture.txt"]); git(["commit", "--no-gpg-sign", "-m", "Generated base"]); git(["remote", "add", "origin", remote]); git(["push", "origin", "main"]);
  const provider: ProviderAdapter = configuredProvider ?? {
    state: { status: "disconnected", models: [], login: null, diagnostic: "Generated offline Git-only fixture" }, onChange: () => {},
    refresh: async () => {}, login: () => { throw new Error("Generated fixture forbids personal authorization."); }, cancel: async () => {}, logout: async () => {},
    prepare: async () => { throw new Error("Generated fixture forbids inference."); },
  };
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    service = await startService({ stateDir, retentionKey, provider, platform: {
      terminal: { executable: process.execPath, args: ["-e", "process.stdin.resume()"], defaultRoot: home },
      integrations: { ...integrations, githubCliRead: async (endpoint, root, signal) => {
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
    generatedNodeSupervision(service);
    sdk = new MoguriSdk(service.connection); await connectGithubSdk(sdk);
    const projectId = (await sdk.command({ type: "project.add", path: root })).id!;
    const sessionId = (await appendLegacyProjectSession(sdk, service.controller, projectId, "Generated GitHub workflow")).id;
    const scope: GithubScope = { env: "Local", projectId, sessionId };
    const session = () => sdk!.getState().snapshot!.sessions.find((value) => value.id === sessionId)!;
    return { directory, root, remote, hooks, stateDir, service, sdk, scope, projectId, sessionId, session, git, bare, githubProgram: options.runProgram,
      close: async () => { sdk!.disconnect(); await service!.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    sdk?.disconnect(); await service?.close(); await rm(directory, { recursive: true, force: true }); throw error;
  }
}
export async function githubApplicationFixture(options: { provider?: ProviderAdapter; ownedNetwork?: boolean; retentionKey?: Buffer; integrations?: IntegrationOptions;
  github?: Omit<GitHubWorkflowOptions, "runProgram">; beforeRead?: (path: string, signal: AbortSignal) => Promise<void> } = {}) {
    const calls: { method: string; path: string }[] = [];
    const repository = { id: 41, name: "fixture", full_name: "generated-owner/fixture",
      owner: { login: "generated-owner", type: "User" }, description: "Generated application repository",
      html_url: "https://github.com/generated-owner/fixture", visibility: "private", private: true, default_branch: "main",
      ssh_url: "git@github.com:generated-owner/fixture.git", clone_url: "https://github.com/generated-owner/fixture.git", license: { spdx_id: "MIT" } };
    let head = "", changedBody = false, issueWrites = 0, prWrites = 0, accountId = 42;
    const ci: { checks?: unknown[]; statuses?: unknown[]; runs?: unknown[]; annotations?: unknown[];
      checkPages?: unknown[][]; runPages?: unknown[][]; checkCount?: unknown; statusCount?: unknown; runCount?: unknown } = {};
    const search: { items?: unknown[]; total?: unknown; incomplete?: boolean; omitTotal?: boolean; next?: boolean } = {};
    const issue = (number: number, title = "Generated issue", body = "Generated **issue body**.") => ({ id: number + 100, number, title, body: changedBody ? "Generated changed source." : body, state: "open",
      html_url: `https://github.com/${repository.full_name}/issues/${number}`, updated_at: "2026-01-01T00:00:00Z", user: { login: "generated-owner" } });
    const pull = (number: number, title = "Generated pull request", body = "Generated **pull request body**.", draft = true) => ({ ...issue(number, title, body),
      html_url: `https://github.com/${repository.full_name}/pull/${number}`, draft, merged: false,
      base: { ref: "main", sha: head, repo: repository }, head: { ref: "generated-feature", sha: head, repo: repository } });
    const issues = [issue(7)], pulls: ReturnType<typeof pull>[] = [];
    const fixture = await githubServiceFixture({ ...options.github, runProgram: async (executable, args, request) => {
      if (executable !== "gh") return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      const index = args.indexOf("--method"), method = args[index + 1]!, requested = args[index + 2]!;
      calls.push({ method, path: requested });
      if (method === "GET") await options.beforeRead?.(requested, request.signal);
      const path = repository.full_name !== "generated-owner/fixture" && requested.startsWith(`repos/${repository.full_name}`) ?
        requested.replace(`repos/${repository.full_name}`, "repos/generated-owner/fixture") : requested;
      const fields: Record<string, string> = {};
      for (let index = 0; index < args.length - 1; index++) if (args[index] === "--raw-field" || args[index] === "--field") {
        const value = args[index + 1]!, split = value.indexOf("="); fields[value.slice(0, split)] = value.slice(split + 1);
      }
      let data: unknown, nextPage = false;
      const requestedPage = Number(path.match(/[?&]page=(\d+)/)?.[1] ?? 1);
      if (path === "user") data = { login: "generated-owner", id: accountId };
      else if (path.startsWith("search/issues?")) {
        const perPage = Number(path.match(/[?&]per_page=(\d+)/)?.[1] ?? 30);
        const all = search.items ?? issues.map((item) => ({ ...item, repository_url: `https://api.github.com/repos/${repository.full_name}` }));
        data = { ...(search.omitTotal ? {} : { total_count: search.total !== undefined ? search.total : all.length }),
          incomplete_results: search.incomplete ?? false, items: all.slice((requestedPage - 1) * perPage, requestedPage * perPage) };
        nextPage = search.next ?? requestedPage * perPage < all.length;
      }
      else if (path.startsWith("user/repos?")) data = [repository];
      else if (path === "repos/generated-owner/fixture") data = repository;
      else if (path.startsWith("repos/generated-owner/fixture/branches/")) {
        const name = decodeURIComponent(path.split("/branches/")[1]!);
        let branchHead = head;
        if (options.ownedNetwork) {
          try { branchHead = fixture.bare(["rev-parse", "--verify", `refs/heads/${name}`]); }
          catch { return "HTTP/2.0 404 Not Found\r\n\r\n{}"; }
        }
        data = { name, commit: { sha: branchHead } };
      }
      else if (method === "POST" && path === "repos/generated-owner/fixture/issues") { issueWrites++; const created = issue(20 + issueWrites, fields.title, fields.body); issues.push(created); data = created; }
      else if (method === "POST" && path === "repos/generated-owner/fixture/pulls") {
        prWrites++; const created = pull(30 + prWrites, fields.title, fields.body, fields.draft === "true");
        if (options.ownedNetwork) created.head = { ref: fields.head!, sha: fixture.bare(["rev-parse", "--verify", `refs/heads/${fields.head}`]), repo: repository };
        pulls.push(created); data = created;
      }
      else if (path.startsWith("repos/generated-owner/fixture/issues?")) data = issues;
      else if (path.startsWith("repos/generated-owner/fixture/pulls?")) data = pulls;
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/files\?/.test(path)) data = [{ filename: "generated.ts", status: "modified", additions: 1, deletions: 1,
        patch: "@@ -1 +1 @@\n-old generated line\n+new generated line", blob_url: "https://github.com/generated-owner/fixture/blob/generated-feature/generated.ts" }];
      else if (path.startsWith("repos/generated-owner/fixture/actions/runs?")) {
        const all = ci.runPages?.flat() ?? ci.runs ?? [{ id: 80, name: "Generated CI", status: "completed", conclusion: "success",
          head_sha: head, html_url: "https://github.com/generated-owner/fixture/actions/runs/80" }];
        const runs = ci.runPages ? ci.runPages[requestedPage - 1] ?? [] : requestedPage === 1 ? all : [];
        nextPage = Boolean(ci.runPages && requestedPage < ci.runPages.length);
        data = { workflow_runs: runs, total_count: ci.runCount !== undefined ? ci.runCount : all.length };
      }
      else if (path === "repos/generated-owner/fixture/actions/runs/80") data = { id: 80, name: "Generated CI", status: "completed", conclusion: "success", head_sha: head };
      else if (path.startsWith("repos/generated-owner/fixture/actions/runs/80/jobs?")) data = { jobs: [{ id: 81, name: "Generated build", status: "completed", conclusion: "success",
        head_sha: head, steps: [{ name: "Generated install", status: "completed", conclusion: "success" }, { name: "Generated test", status: "completed", conclusion: "success" }] }] };
      else if (/\/check-runs\/\d+\/annotations\?/.test(path)) {
        data = (ci.annotations ?? []).slice((requestedPage - 1) * 100, requestedPage * 100);
        nextPage = requestedPage * 100 < (ci.annotations?.length ?? 0);
      }
      else if (/\/check-runs\/\d+$/.test(path)) {
        const id = Number(path.split("/").at(-1));
        const selected = ci.checks?.find((value) => typeof value === "object" && value !== null && "id" in value && value.id === id);
        data = { id, head_sha: head, output: { annotations_count: ci.annotations?.length ?? 0 }, ...(typeof selected === "object" && selected !== null ? selected : {}) };
      }
      else if (/\/commits\/[a-f0-9]+\/check-runs\?/.test(path)) {
        const all = ci.checkPages?.flat() ?? ci.checks ?? [{ id: 82, name: "Generated checks", status: "completed", conclusion: "success", head_sha: head }];
        const checks = ci.checkPages ? ci.checkPages[requestedPage - 1] ?? [] : requestedPage === 1 ? all : [];
        nextPage = Boolean(ci.checkPages && requestedPage < ci.checkPages.length);
        data = { check_runs: checks, total_count: ci.checkCount !== undefined ? ci.checkCount : all.length };
      }
      else if (/\/commits\/[a-f0-9]+\/status\?/.test(path)) data = { sha: head, statuses: requestedPage === 1 ? ci.statuses ?? [] : [], total_count: ci.statusCount !== undefined ? ci.statusCount : ci.statuses?.length ?? 0 };
      else if (/^repos\/generated-owner\/fixture\/commits\/[a-f0-9]+$/.test(path)) data = { sha: head };
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/comments\?/.test(path)) data = [{ id: 83, body: "Generated inline review comment.", path: "generated.ts", line: 1,
        state: "COMMENTED", user: { login: "generated-reviewer" }, html_url: "https://github.com/generated-owner/fixture/pull/11#discussion_r83" }];
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/reviews\?/.test(path)) data = [{ id: 84, body: "Generated approved review.", state: "APPROVED", user: { login: "generated-reviewer" } }];
      else if (path === "graphql") data = { data: { repository: { nameWithOwner: repository.full_name, pullRequest: { number: Number(fields.number ?? 11), headRefOid: head,
        reviewThreads: { nodes: [{ id: "GENERATED_THREAD", isResolved: false, isOutdated: false, comments: { nodes: [{ databaseId: 83, body: "Generated unresolved thread.", updatedAt: "2026-01-01T00:00:00Z", author: { login: "generated-reviewer" } }] } }],
          pageInfo: { hasNextPage: false, endCursor: null } } } } } };
      else if (/^repos\/generated-owner\/fixture\/issues\/\d+$/.test(path)) data = changedBody ? issue(Number(path.split("/").at(-1))) : issues.find((item) => item.number === Number(path.split("/").at(-1)));
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+$/.test(path)) {
        const selected = pulls.find((item) => item.number === Number(path.split("/").at(-1)))!;
        if (options.ownedNetwork) {
          selected.head.sha = fixture.bare(["rev-parse", "--verify", `refs/heads/${selected.head.ref}`]);
          if (method === "PATCH") { selected.title = fields.title ?? selected.title; selected.body = fields.body ?? selected.body; prWrites++; }
        }
        data = selected;
      }
      else throw new Error(`Unexpected generated GitHub request: ${method} ${path}`);
      return `HTTP/2.0 200 OK\r\n${nextPage ? 'Link: <https://api.github.com/generated?page=2>; rel="next"\r\n' : ""}\r\n${JSON.stringify(data)}`;
    } }, options.provider, options.retentionKey, options.integrations);
    head = fixture.git(["rev-parse", "HEAD"]); pulls.push(pull(11));
    fixture.git(["remote", "set-url", "origin", repository.ssh_url]);
    fixture.git(["switch", "-c", "generated-feature"]);
    if (options.ownedNetwork) {
      const executable = join(fixture.directory, "generated-git-ssh.mjs");
      await writeFile(executable, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const request = process.argv.at(-1);
const allowed = ["git-upload-pack 'generated-owner/fixture.git'", "git-receive-pack 'generated-owner/fixture.git'"];
if (!allowed.includes(request)) process.exit(65);
const command = request.startsWith("git-upload-pack") ? "git-upload-pack" : "git-receive-pack";
const result = spawnSync(command, [${JSON.stringify(fixture.remote)}], { stdio: "inherit", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
if (result.error) { console.error(result.error.message); process.exit(66); }
process.exit(result.status ?? 67);
`, { mode: 0o700 });
      fixture.git(["config", "core.sshCommand", JSON.stringify(executable)]);
      fixture.bare(["update-ref", "refs/heads/generated-feature", head]);
      fixture.bare(["update-ref", "refs/pull/11/head", head]);
    }
    const board = defaultBoard(fixture.projectId);
    await fixture.sdk.issues.configure(fixture.projectId, { ...board, autoRefreshPrs: false }, 0);
    return { ...fixture, calls, repository, addPull: (number: number) => { pulls.push(pull(number, `Generated PR ${number}`)); },
      relocate: (fullName: string) => {
        repository.full_name = fullName; repository.owner = { login: fullName.split("/")[0]!, type: "Organization" };
        repository.html_url = `https://github.com/${fullName}`; repository.ssh_url = `git@github.com:${fullName}.git`;
        repository.clone_url = `https://github.com/${fullName}.git`;
        for (const value of issues) value.html_url = `${repository.html_url}/issues/${value.number}`;
        for (const value of pulls) value.html_url = `${repository.html_url}/pull/${value.number}`;
      },
      changeHead: (value: string) => { head = value; for (const item of pulls) item.head.sha = value; },
      setCi: (value: typeof ci) => { Object.assign(ci, value); },
      setSearch: (value: typeof search) => { Object.assign(search, value); },
      closePull: (number: number) => { const selected = pulls.find((pull) => pull.number === number); if (!selected) throw new Error("Generated PR is absent."); selected.state = "closed"; },
      changeSource: () => { changedBody = true; }, changeAccount: (id: number) => { accountId = id; }, writes: () => ({ issues: issueWrites, pulls: prWrites }) };
}
