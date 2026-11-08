import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { githubServiceFixture } from "./github-workflows-fixture.ts";
import { runProgram } from "../apps/service/src/program.ts";
import type { GithubScope } from "../packages/sdk/src/index.ts";
import type { GitHubWorkflowOptions } from "../apps/service/src/github-workflows.ts";

export interface GeneratedWorkPull {
  number: number; state: "open" | "closed"; merged: boolean; head: string; updatedAt: string;
  title: string; body: string; requests: { kind: "user" | "team" | "bot" | "mannequin" | "enterprise-team"; login: string }[];
  threads: { id: string; commentId: number; resolved: boolean; outdated: boolean }[];
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
}
export interface GeneratedWorkRepository {
  root: string; repository: string; account: string; accountId: number; repositoryId: number; scope: GithubScope;
  pulls: GeneratedWorkPull[]; checks: Record<string, unknown>[]; statuses: Record<string, unknown>[]; runs: Record<string, unknown>[];
  annotations: Record<string, unknown>[]; revoked: boolean; outage: boolean;
  malformedThreads: boolean; repeatedCursor: boolean; countOverride?: number;
  pullPages?: number[][];
}
export async function myWorkFixture(options: {
  beforeRead?: (repository: GeneratedWorkRepository, path: string, signal: AbortSignal) => Promise<void>;
  now?: () => number; retentionKey?: Buffer;
  wait?: GitHubWorkflowOptions["wait"];
} = {}) {
  const repositories = new Map<string, GeneratedWorkRepository>(), calls: { root: string; method: string; path: string }[] = [];
  const fixture = await githubServiceFixture({ now: options.now, wait: options.wait, runProgram: async (executable, args, request) => {
    if (executable !== "gh") return runProgram(executable, args, { ...request, env: {
      ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    const index = args.indexOf("--method"), method = args[index + 1]!, path = args[index + 2]!;
    calls.push({ root: request.cwd, method, path });
    const repo = repositories.get(request.cwd);
    if (!repo) throw new Error("Generated inbox request has no original root/account fixture.");
    await options.beforeRead?.(repo, path, request.signal);
    request.signal.throwIfAborted();
    if (repo.revoked && path !== "user") return "HTTP/2.0 403 Forbidden\r\n\r\n{}";
    if (repo.outage && path !== "user") return "HTTP/2.0 502 Bad Gateway\r\n\r\n{}";
    const fields: Record<string, string> = {};
    for (let index = 0; index < args.length - 1; index++) if (["--raw-field", "--field"].includes(args[index]!)) {
      const field = args[index + 1]!, split = field.indexOf("="); fields[field.slice(0, split)] = field.slice(split + 1);
    }
    const page = Number(path.match(/[?&]page=(\d+)/)?.[1] ?? 1), perPage = Number(path.match(/[?&]per_page=(\d+)/)?.[1] ?? 100);
    const metadata = { id: repo.repositoryId, full_name: repo.repository, name: repo.repository.split("/")[1],
      owner: { login: repo.repository.split("/")[0], type: "User" }, private: true, visibility: "private",
      html_url: `https://github.com/${repo.repository}`, default_branch: "main", description: "Generated inbox repository",
      ssh_url: `git@github.com:${repo.repository}.git`, clone_url: `https://github.com/${repo.repository}.git`, license: { spdx_id: "MIT" } };
    const pull = (value: GeneratedWorkPull) => ({ id: value.number + 100, number: value.number, state: value.state,
      merged: value.merged, title: value.title, body: value.body, draft: false, updated_at: value.updatedAt,
      html_url: `https://github.com/${repo.repository}/pull/${value.number}`, user: { login: repo.account },
      base: { ref: "main", sha: value.head, repo: metadata }, head: { ref: "generated-feature", sha: value.head, repo: metadata } });
    let data: unknown, next = false;
    const paginate = (values: unknown[]) => {
      next = page * perPage < values.length; return values.slice((page - 1) * perPage, page * perPage);
    };
    const selected = repo.pulls.find((pull) => pull.number === Number(path.match(/\/pulls\/(\d+)/)?.[1] ?? fields.number ?? 11));
    if (path === "user") data = { login: repo.account, id: repo.accountId };
    else if (path === `repos/${repo.repository}`) data = metadata;
    else if (path.startsWith(`repos/${repo.repository}/pulls?`)) {
      if (repo.pullPages) {
        next = page < repo.pullPages.length;
        data = (repo.pullPages[page - 1] ?? []).map((number) => {
          const selected = repo.pulls.find((pull) => pull.number === number);
          if (!selected) throw new Error("Generated PR page references an absent item.");
          return pull(selected);
        });
      } else data = paginate(repo.pulls.filter((pull) => path.includes("state=open") ? pull.state === "open" : true).map(pull));
    }
    else if (path === `repos/${repo.repository}/pulls/${selected?.number}`) data = pull(selected!);
    else if (path === "graphql") {
      if (!selected) return "HTTP/2.0 404 Not Found\r\n\r\n{}";
      const requests = fields.query!.includes("reviewRequests("), offset = fields.after ? Number(fields.after.replace("generated-cursor-", "")) : 0;
      const nodes = requests ? selected.requests.map((request, index) => ({ id: `GENERATED_REQUEST_${index}`,
        requestedReviewer: request.kind === "enterprise-team" ? { __typename: "EnterpriseTeam", id: "GENERATED_ENTERPRISE_TEAM", combinedSlug: request.login } :
          request.kind === "team" ? { __typename: "Team", id: `GENERATED_TEAM_${index}`, slug: request.login.split("/")[1],
          organization: { login: request.login.split("/")[0] }, url: `https://github.com/orgs/${request.login.split("/")[0]}/teams/${request.login.split("/")[1]}` } :
          { __typename: request.kind === "bot" ? "Bot" : request.kind === "mannequin" ? "Mannequin" : "User",
            id: `GENERATED_REVIEWER_${index}`, login: request.login, url: `https://github.com/${request.kind === "bot" ? "apps/generated-review-bot" : request.login}` } })) :
        selected.threads.map((thread) => ({ id: thread.id, ...(repo.malformedThreads ? {} : { isResolved: thread.resolved }),
          isOutdated: thread.outdated, path: "fixture.ts", line: 1,
          comments: { nodes: [{ databaseId: thread.commentId, body: "Generated unresolved review conversation.",
            url: `https://github.com/${repo.repository}/pull/${selected.number}#discussion_r${thread.commentId}` }] } }));
      data = { data: { repository: { nameWithOwner: repo.repository, pullRequest: { number: selected.number,
        state: selected.merged ? "MERGED" : selected.state.toUpperCase(), headRefOid: selected.head, reviewDecision: selected.decision,
        [requests ? "reviewRequests" : "reviewThreads"]: { totalCount: repo.countOverride ?? nodes.length, nodes: nodes.slice(offset, offset + 100),
          pageInfo: { hasNextPage: offset + 100 < nodes.length, endCursor: repo.repeatedCursor ? "generated-cursor-100" : `generated-cursor-${offset + 100}` } } } } } };
    } else if (path.includes("/check-runs?")) data = { check_runs: paginate(repo.checks), total_count: repo.checks.length };
    else if (path.includes("/status?")) data = { sha: path.match(/\/commits\/([a-f0-9]+)\//)?.[1], statuses: paginate(repo.statuses), total_count: repo.statuses.length };
    else if (path.startsWith(`repos/${repo.repository}/actions/runs?`)) data = { workflow_runs: paginate(repo.runs), total_count: repo.runs.length };
    else if (path.includes("/annotations?")) data = paginate(repo.annotations);
    else if (/\/check-runs\/\d+$/.test(path)) data = { ...repo.checks.find((check) => check.id === Number(path.split("/").at(-1))),
      output: { title: "Generated startup failure", summary: "Generated runner could not start because the fixture billing allowance is exhausted.", annotations_count: repo.annotations.length } };
    else if (/\/commits\/[a-f0-9]+$/.test(path)) data = { sha: path.split("/").at(-1) };
    else return "HTTP/2.0 404 Not Found\r\n\r\n{}";
    return `HTTP/2.0 200 OK\r\n${next ? 'Link: <https://api.github.com/generated?page=2>; rel="next"\r\n' : ""}\r\n${JSON.stringify(data)}`;
  } }, undefined, options.retentionKey, { fetch: async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const match = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(?:\/pulls\/(\d+))?$/);
    const repo = [...repositories.values()].find((repo) => repo.repository === match?.[1]);
    if (url.origin !== "https://api.github.com" || !match || !repo) throw new Error("Generated inbox fixture forbids unconfigured public GitHub or external HTTP.");
    const pull = repo.pulls.find((pull) => pull.number === Number(match[2]));
    if (match[2] && !pull) return Response.json({}, { status: 404 });
    if (!pull) return Response.json({ id: repo.repositoryId, full_name: repo.repository, name: repo.repository.split("/")[1],
      owner: { login: repo.repository.split("/")[0], type: "User" }, html_url: `https://github.com/${repo.repository}`, private: true, visibility: "private",
      default_branch: "main", description: "Generated inbox metadata", license: { spdx_id: "MIT" } });
    return Response.json({ number: pull.number, html_url: `https://github.com/${repo.repository}/pull/${pull.number}`,
      state: pull.state, merged: pull.merged, merged_at: pull.merged ? "2026-01-01T00:00:00Z" : null, draft: false, head: { sha: pull.head } });
  } });
  const head = fixture.git(["rev-parse", "HEAD"]);
  const addRepository = async (name: string, account: string, id: number, original = false, repository = `generated-owner/${name}`) => {
    const root = original ? fixture.root : join(fixture.directory, name);
    const git = (args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd: root, encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!original) {
      await mkdir(root); git(["init", "--initial-branch=main"]); git(["config", "user.name", "Generated Inbox"]);
      git(["config", "user.email", "generated@example.invalid"]); git(["config", "core.hooksPath", fixture.hooks]);
      await writeFile(join(root, "fixture.txt"), "generated inbox\n"); git(["add", "--", "fixture.txt"]);
      git(["commit", "--no-gpg-sign", "-m", "Generated inbox"]); git(["remote", "add", "origin", `git@github.com:${repository}.git`]);
    } else git(["remote", "set-url", "origin", `git@github.com:${repository}.git`]);
    const projectId = original ? fixture.projectId : (await fixture.sdk.projects.add(root)).id!;
    const repo: GeneratedWorkRepository = { root, repository, account, accountId: id, repositoryId: id + 1000,
      scope: { env: "Local", projectId }, pulls: [{
        number: 11, state: "open", merged: false, head, updatedAt: "2026-01-01T00:00:00Z",
        title: `Generated ${name} work`, body: "Generated full PR body. A comment is not a review request.",
        requests: [{ kind: "user", login: account }], threads: [{ id: "GENERATED_THREAD", commentId: 83, resolved: false, outdated: false }],
        decision: "REVIEW_REQUIRED",
      }], checks: [{ id: 82, name: "Generated check", status: "completed", conclusion: "success", head_sha: head,
        html_url: `https://github.com/generated-owner/${name}/actions/runs/80` }], statuses: [], runs: [],
      annotations: [], revoked: false, outage: false, malformedThreads: false, repeatedCursor: false };
    repositories.set(root, repo);
    return repo;
  };
  try {
    const first = await addRepository("inbox-a", "generated-a", 42, true), second = await addRepository("inbox-b", "generated-b", 43);
    const configure = async (repo: GeneratedWorkRepository) => {
      const { preview } = await fixture.sdk.myWork.previewSource(repo.scope);
      return (await fixture.sdk.myWork.configure(preview, true)).id!;
    };
    return { ...fixture, repositories, first, second, calls, configure, addRepository, head };
  } catch (error) { await fixture.close(); throw error; }
}
