import type { IntakeClock } from "../apps/service/src/session-intake.ts";
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
export async function githubServiceFixture(options: GitHubWorkflowOptions = {}, configuredProvider?: ProviderAdapter, retentionKey: Buffer = randomBytes(32), integrations: IntegrationOptions = {},
  intakeClock?: IntakeClock) {
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
      ...(intakeClock ? { intakeClock } : {}),
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
    type GeneratedLabel = { id: number; name: string; color: string; description: string | null };
    const repositoryLabels: GeneratedLabel[] = [{ id: 901, name: "generated-label", color: "0e8a16", description: "Generated label" },
      { id: 902, name: "generated-bug", color: "d73a4a", description: "Generated bug report" }, { id: 903, name: "generated-docs", color: "0075ca", description: null }];
    const assignable = ["generated-owner", "generated-reviewer", "generated-teammate"].map((login, index) => ({ id: 42 + index, login, type: "User", html_url: `https://github.com/${login}` }));
    const events = new Map<number, Record<string, unknown>[]>(), reviewComments = new Map<number, Record<string, unknown>[]>();
    let eventId = 9100, reviewCommentDrift = false;
    const recordEvent = (number: number, event: string, subject: Record<string, unknown> = {}) => {
      const list = events.get(number) ?? []; events.set(number, list);
      list.push({ id: ++eventId, event, actor: { login: "generated-owner" }, created_at: new Date(Date.UTC(2026, 0, 3, 0, 0, eventId - 9100)).toISOString(), ...subject });
    };
    const issue = (number: number, title = "Generated issue", body = "Generated **issue body**.") => ({ id: number + 100, number, title, body: changedBody ? "Generated changed source." : body, state: "open",
      html_url: `https://github.com/${repository.full_name}/issues/${number}`, updated_at: "2026-01-01T00:00:00Z", created_at: "2025-12-31T00:00:00Z", user: { login: "generated-owner" },
      labels: [] as GeneratedLabel[], assignees: [] as { login: string }[] });
    const pull = (number: number, title = "Generated pull request", body = "Generated **pull request body**.", draft = true) => ({ ...issue(number, title, body),
      html_url: `https://github.com/${repository.full_name}/pull/${number}`, draft, merged: false, node_id: `PR_generated_${number}`,
      labels: [{ ...repositoryLabels[0]! }], assignees: [{ login: "generated-owner" }], requested_reviewers: [{ login: "generated-reviewer" }], commits: 2, changed_files: 1,
      base: { ref: "main", sha: head, repo: repository }, head: { ref: "generated-feature", sha: head, repo: repository } });
    type GeneratedPull = ReturnType<typeof pull>;
    const issues = [issue(7)], pulls: GeneratedPull[] = [], deletedBranches = new Set<string>();
    const firstCommit = `c0ffee${"0".repeat(34)}`;
    const commits = () => [{ sha: firstCommit, message: "Generated first commit\n\nGenerated commit details.", date: "2026-01-01T00:00:00Z" },
      { sha: head, message: "Generated head commit", date: "2026-01-01T01:00:00Z" }].map((value) => ({ sha: value.sha, html_url: `${repository.html_url}/commit/${value.sha}`,
      author: { login: "generated-owner" }, commit: { message: value.message, author: { name: "Generated Author", date: value.date }, committer: { name: "Generated Author", date: value.date } } }));
    const timeline = (number: number) => {
      const selected = pulls.find((item) => item.number === number);
      return [...(selected ? [...commits().map((value) => ({ event: "committed", sha: value.sha, html_url: value.html_url, message: value.commit.message,
        author: value.commit.author, committer: value.commit.committer })),
      { id: 9001, event: "review_requested", actor: { login: "generated-owner" }, requested_reviewer: { login: "generated-reviewer" }, created_at: "2026-01-01T02:00:00Z" },
      { id: 9002, event: "labeled", actor: { login: "generated-owner" }, label: { name: "generated-label", color: "0e8a16" }, created_at: "2026-01-01T02:00:01Z" },
      { id: 9003, event: "commented", body: "Generated conversation comment.", user: { login: "generated-reviewer" }, created_at: "2026-01-01T03:00:00Z",
        updated_at: "2026-01-01T03:00:00Z", html_url: `${selected.html_url}#issuecomment-9003` },
      { id: 84, event: "reviewed", body: "Generated approved review.", state: "approved", user: { login: "generated-reviewer" }, commit_id: head,
        submitted_at: "2026-01-01T04:00:00Z", html_url: `${selected.html_url}#pullrequestreview-84` },
      { event: "line-commented", comments: [{ id: 83, body: "Generated inline review comment.", path: "generated.ts", line: 1, user: { login: "generated-reviewer" },
        updated_at: "2026-01-01T04:00:00Z", html_url: `${selected.html_url}#discussion_r83` }] },
      { id: 9004, event: "renamed", actor: { login: "generated-owner" }, rename: { from: "Generated draft title", to: "Generated pull request" }, created_at: "2026-01-01T05:00:00Z" }] : []),
      ...events.get(number) ?? []];
    };
    const isPull = (value: ReturnType<typeof issue>): value is GeneratedPull => "head" in value;
    const workItem = (number: number): ReturnType<typeof issue> | undefined => issues.find((item) => item.number === number) ?? pulls.find((item) => item.number === number);
    const issueView = (value: ReturnType<typeof issue>) => {
      if (!isPull(value)) return value;
      const { head: _head, base: _base, merged: _merged, requested_reviewers: _reviewers, commits: _commits, changed_files: _files, node_id: _node, ...rest } = value;
      return { ...rest, pull_request: { url: `https://api.github.com/repos/${repository.full_name}/pulls/${value.number}`, html_url: value.html_url } };
    };
    const checkDefaults = (value: unknown) => {
      const check = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}, url = `${repository.html_url}/actions/runs/80/job/${String(check.id)}`;
      return { html_url: url, details_url: url, started_at: "2026-01-01T00:00:00Z", app: { slug: "github-actions" }, ...check };
    };
    const listed = (path: string, state: string) => { const requested = /[?&]state=(open|closed)\b/.exec(path)?.[1]; return !requested || requested === state; };
    const fixture = await githubServiceFixture({ ...options.github, runProgram: async (executable, args, request) => {
      if (executable !== "gh") return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      const index = args.indexOf("--method"), method = args[index + 1]!, requested = args[index + 2]!;
      calls.push({ method, path: requested });
      if (method === "GET") await options.beforeRead?.(requested, request.signal);
      const path = repository.full_name !== "generated-owner/fixture" && requested.startsWith(`repos/${repository.full_name}`) ?
        requested.replace(`repos/${repository.full_name}`, "repos/generated-owner/fixture") : requested;
      const fields: Record<string, string> = {}, arrays: Record<string, string[]> = {};
      for (let index = 0; index < args.length - 1; index++) if (args[index] === "--raw-field" || args[index] === "--field") {
        const value = args[index + 1]!, split = value.indexOf("="), key = split < 0 ? value : value.slice(0, split);
        if (key.endsWith("[]")) { const list = arrays[key.slice(0, -2)] ??= []; if (split >= 0) list.push(value.slice(split + 1)); }
        else fields[key] = value.slice(split + 1);
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
      else if (path.startsWith("repos/generated-owner/fixture/issues?")) data = issues.filter((item) => listed(path, item.state));
      // Like GitHub, the pull list omits the "merged" boolean; only merged_at marks a merged PR there.
      else if (path.startsWith("repos/generated-owner/fixture/pulls?")) data = pulls.filter((item) => listed(path, item.state)).map(({ merged: _merged, commits: _commits, changed_files: _files, ...rest }) => rest);
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/commits\?/.test(path)) {
        const perPage = Number(path.match(/[?&]per_page=(\d+)/)?.[1] ?? 30), all = commits();
        data = all.slice((requestedPage - 1) * perPage, requestedPage * perPage); nextPage = requestedPage * perPage < all.length;
      }
      else if (/^repos\/generated-owner\/fixture\/issues\/\d+\/timeline\?/.test(path)) data = requestedPage === 1 ? timeline(Number(path.split("/")[4])) : [];
      else if (/^repos\/generated-owner\/fixture\/contents\/generated\.ts\?ref=[a-f0-9]{40}$/.test(path)) data = { type: "file", name: "generated.ts", path: "generated.ts",
        sha: "1".repeat(40), encoding: "base64", content: Buffer.from("new generated line\ngenerated second line\ngenerated third line\n").toString("base64"),
        html_url: "https://github.com/generated-owner/fixture/blob/generated-feature/generated.ts" };
      else if (path.startsWith("repos/generated-owner/fixture/labels?")) data = requestedPage === 1 ? repositoryLabels : [];
      else if (path.startsWith("repos/generated-owner/fixture/assignees?")) data = requestedPage === 1 ? assignable : [];
      else if (method === "PUT" && /^repos\/generated-owner\/fixture\/issues\/\d+\/labels$/.test(path)) {
        const selected = workItem(Number(path.split("/")[4]))!, before = new Set(selected.labels.map((label) => label.name.toLowerCase()));
        if (!arrays.labels) return "HTTP/2.0 422 Unprocessable Entity\r\n\r\n{}";
        selected.labels = arrays.labels.map((name) => {
          let label = repositoryLabels.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
          if (!label) { label = { id: 904 + repositoryLabels.length, name, color: "ededed", description: null }; repositoryLabels.push(label); }
          return { ...label };
        });
        const after = new Set(selected.labels.map((label) => label.name.toLowerCase()));
        for (const label of selected.labels) if (!before.has(label.name.toLowerCase())) recordEvent(selected.number, "labeled", { label: { name: label.name, color: label.color } });
        for (const name of before) if (!after.has(name)) recordEvent(selected.number, "unlabeled", { label: { name, color: null } });
        data = selected.labels;
      }
      else if (method === "POST" && /^repos\/generated-owner\/fixture\/pulls\/\d+\/comments$/.test(path)) {
        const selected = pulls.find((item) => item.number === Number(path.split("/")[4]));
        const line = Number(fields.line), startLine = fields.start_line === undefined ? null : Number(fields.start_line);
        if (!selected || selected.state !== "open" || fields.commit_id !== selected.head.sha || !fields.path || !fields.body || !Number.isSafeInteger(line) ||
          !["LEFT", "RIGHT"].includes(fields.side ?? "") || (startLine === null) !== (fields.start_side === undefined)) return "HTTP/2.0 422 Unprocessable Entity\r\n\r\n{}";
        const list = reviewComments.get(selected.number) ?? [], id = 8300 + [...reviewComments.values()].flat().length + 1;
        reviewComments.set(selected.number, list);
        const comment = { id, body: fields.body, path: fields.path, line: reviewCommentDrift ? line + 1 : line, side: fields.side, start_line: startLine, start_side: fields.start_side ?? null,
          commit_id: fields.commit_id, original_commit_id: fields.commit_id, user: { login: "generated-owner" }, created_at: "2026-01-04T00:00:00Z", updated_at: "2026-01-04T00:00:00Z",
          pull_request_url: `https://api.github.com/repos/${repository.full_name}/pulls/${selected.number}`, html_url: `${selected.html_url}#discussion_r${id}` };
        list.push(comment); recordEvent(selected.number, "line-commented", { comments: [comment] });
        data = comment;
      }
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/requested_reviewers$/.test(path) && (method === "POST" || method === "DELETE")) {
        const selected = pulls.find((item) => item.number === Number(path.split("/")[4]))!, requested = arrays.reviewers ?? [];
        if (!arrays.reviewers || method === "POST" && requested.some((login) => login.toLowerCase() === selected.user.login.toLowerCase())) return "HTTP/2.0 422 Unprocessable Entity\r\n\r\n{}";
        for (const login of requested) {
          const present = selected.requested_reviewers.some((entry) => entry.login.toLowerCase() === login.toLowerCase());
          if (method === "POST" && !present) { selected.requested_reviewers.push({ login }); recordEvent(selected.number, "review_requested", { requested_reviewer: { login } }); }
          if (method === "DELETE" && present) {
            selected.requested_reviewers = selected.requested_reviewers.filter((entry) => entry.login.toLowerCase() !== login.toLowerCase());
            recordEvent(selected.number, "review_request_removed", { requested_reviewer: { login } });
          }
        }
        data = selected;
      }
      else if (method === "PUT" && /^repos\/generated-owner\/fixture\/pulls\/\d+\/merge$/.test(path)) {
        const selected = pulls.find((item) => item.number === Number(path.split("/")[4]));
        if (!selected || selected.state !== "open" || selected.draft || fields.sha !== selected.head.sha) return "HTTP/2.0 409 Conflict\r\n\r\n{}";
        const sha = `feed${"0".repeat(36)}`;
        Object.assign(selected, { merged: true, state: "closed", merged_at: "2026-01-05T00:00:00Z", merge_commit_sha: sha }); recordEvent(selected.number, "merged");
        data = { merged: true, sha, message: "Pull Request successfully merged" };
      }
      else if (/^repos\/generated-owner\/fixture\/git\/refs?\/heads\//.test(path)) {
        const name = decodeURIComponent(path.split("/heads/")[1]!);
        if (deletedBranches.has(name) || !pulls.some((item) => item.head.ref === name)) return "HTTP/2.0 404 Not Found\r\n\r\n{}";
        if (method === "DELETE") { deletedBranches.add(name); return "HTTP/2.0 204 No Content\r\n\r\n"; }
        data = { ref: `refs/heads/${name}`, object: { type: "commit", sha: pulls.find((item) => item.head.ref === name)!.head.sha } };
      }
      else if (path === "graphql" && /revertPullRequest/.test(fields.query ?? "")) {
        const selected = pulls.find((item) => item.node_id === fields.id);
        if (!selected?.merged) data = { errors: [{ message: "Generated revert needs a merged pull request." }] };
        else {
          const created = pull(40 + pulls.length, `Revert "${selected.title}"`, `Reverts #${selected.number}`, fields.draft === "true");
          created.head = { ref: `revert-${selected.number}-${selected.head.ref}`, sha: head, repo: repository }; pulls.push(created);
          data = { data: { revertPullRequest: { revertPullRequest: { number: created.number, url: created.html_url, isDraft: created.draft, repository: { nameWithOwner: repository.full_name } } } } };
        }
      }
      else if (path === "graphql" && /convertPullRequestToDraft|markPullRequestReadyForReview/.test(fields.query ?? "")) {
        const operation = fields.query!.includes("convertPullRequestToDraft") ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
        const selected = pulls.find((item) => item.node_id === fields.id);
        if (!selected) data = { errors: [{ message: "Generated node is absent." }] };
        else {
          selected.draft = operation === "convertPullRequestToDraft";
          recordEvent(selected.number, selected.draft ? "convert_to_draft" : "ready_for_review");
          data = { data: { [operation]: { pullRequest: { number: selected.number, isDraft: selected.draft, repository: { nameWithOwner: repository.full_name } } } } };
        }
      }
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/files\?/.test(path)) data = [{ filename: "generated.ts", status: "modified", additions: 1, deletions: 1,
        patch: "@@ -1 +1 @@\n-old generated line\n+new generated line", blob_url: "https://github.com/generated-owner/fixture/blob/generated-feature/generated.ts" }];
      else if (path.startsWith("repos/generated-owner/fixture/actions/runs?")) {
        const all = ci.runPages?.flat() ?? ci.runs ?? [{ id: 80, name: "Generated CI", status: "completed", conclusion: "success",
          head_sha: head, html_url: "https://github.com/generated-owner/fixture/actions/runs/80", run_started_at: "2026-01-01T00:00:00Z" }];
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
        const checks = (ci.checkPages ? ci.checkPages[requestedPage - 1] ?? [] : requestedPage === 1 ? all : []).map(checkDefaults);
        nextPage = Boolean(ci.checkPages && requestedPage < ci.checkPages.length);
        data = { check_runs: checks, total_count: ci.checkCount !== undefined ? ci.checkCount : all.length };
      }
      else if (/\/commits\/[a-f0-9]+\/status\?/.test(path)) data = { sha: head, statuses: requestedPage === 1 ? ci.statuses ?? [] : [], total_count: ci.statusCount !== undefined ? ci.statusCount : ci.statuses?.length ?? 0 };
      else if (/^repos\/generated-owner\/fixture\/commits\/[a-f0-9]+$/.test(path)) data = { sha: head };
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/comments\?/.test(path)) data = [{ id: 83, body: "Generated inline review comment.", path: "generated.ts", line: 1,
        state: "COMMENTED", user: { login: "generated-reviewer" }, html_url: "https://github.com/generated-owner/fixture/pull/11#discussion_r83" },
        ...requestedPage === 1 ? reviewComments.get(Number(path.split("/")[4])) ?? [] : []];
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+\/reviews\?/.test(path)) data = [{ id: 84, body: "Generated approved review.", state: "APPROVED", user: { login: "generated-reviewer" } }];
      else if (path === "graphql") data = { data: { repository: { nameWithOwner: repository.full_name, pullRequest: { number: Number(fields.number ?? 11), headRefOid: head,
        reviewThreads: { nodes: [{ id: "GENERATED_THREAD", isResolved: false, isOutdated: false, comments: { nodes: [{ databaseId: 83, body: "Generated unresolved thread.", updatedAt: "2026-01-01T00:00:00Z", author: { login: "generated-reviewer" } }] } }],
          pageInfo: { hasNextPage: false, endCursor: null } } } } } };
      else if (/^repos\/generated-owner\/fixture\/issues\/\d+$/.test(path)) {
        const number = Number(path.split("/").at(-1)), selected = workItem(number);
        if (method === "PATCH" && selected) {
          if (fields.title !== undefined) selected.title = fields.title;
          if (fields.body !== undefined) selected.body = fields.body;
          if (fields.state === "open" || fields.state === "closed") selected.state = fields.state;
          if (arrays.assignees) {
            const before = new Set(selected.assignees.map((entry) => entry.login.toLowerCase()));
            selected.assignees = arrays.assignees.flatMap((login) => assignable.filter((user) => user.login.toLowerCase() === login.toLowerCase()).map((user) => ({ login: user.login })));
            for (const entry of selected.assignees) if (!before.has(entry.login.toLowerCase())) recordEvent(number, "assigned", { assignee: { login: entry.login } });
            for (const login of before) if (!selected.assignees.some((entry) => entry.login.toLowerCase() === login)) recordEvent(number, "unassigned", { assignee: { login } });
          }
          if (isPull(selected)) prWrites++; else issueWrites++;
        }
        data = changedBody && !(selected && isPull(selected)) ? issue(number) : selected && issueView(selected);
      }
      else if (/^repos\/generated-owner\/fixture\/pulls\/\d+$/.test(path)) {
        const selected = pulls.find((item) => item.number === Number(path.split("/").at(-1)))!;
        if (options.ownedNetwork) selected.head.sha = fixture.bare(["rev-parse", "--verify", `refs/heads/${selected.head.ref}`]);
        if (method === "PATCH") {
          if (fields.title !== undefined && fields.title !== selected.title) recordEvent(selected.number, "renamed", { rename: { from: selected.title, to: fields.title } });
          selected.title = fields.title ?? selected.title; selected.body = fields.body ?? selected.body;
          if (fields.state === "open" || fields.state === "closed") selected.state = fields.state;
          prWrites++;
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
      mergePull: (number: number) => { Object.assign(pulls.find((item) => item.number === number)!, { state: "closed", merged: true, merged_at: "2026-01-02T00:00:00Z" }); },
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
      changeSource: () => { changedBody = true; }, changeAccount: (id: number) => { accountId = id; }, writes: () => ({ issues: issueWrites, pulls: prWrites }),
      reviewComments: (number: number) => structuredClone(reviewComments.get(number) ?? []), driftReviewComments: () => { reviewCommentDrift = true; },
      deletedBranches: () => [...deletedBranches],
      workItem: (number: number): (ReturnType<typeof issue> & Partial<GeneratedPull>) | undefined => structuredClone(workItem(number)), timeline: (number: number) => structuredClone(timeline(number)) };
}
