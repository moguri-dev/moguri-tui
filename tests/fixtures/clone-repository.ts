import { createServer, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export async function cloneRepositoryFixture(paths: string[] = ["/generated.git"]) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-clone-")), source = join(directory, "source"), bare = join(directory, "generated.git");
  await mkdir(source);
  const git = (args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: source, stdio: "ignore" });
  git(["init", "-q", "--initial-branch=main"]);
  await writeFile(join(source, "generated.txt"), "Generated repository clone contents.\n");
  await writeFile(join(source, ".gitattributes"), "generated.txt filter=generated-inert-filter\n");
  git(["add", "--", "generated.txt", ".gitattributes"]);
  git(["-c", "user.name=Generated Fixture", "-c", "user.email=generated@example.invalid", "commit", "--no-gpg-sign", "-qm", "Generated clone fixture"]);
  git(["clone", "-q", "--bare", "--no-hardlinks", source, bare]);
  execFileSync("git", ["--git-dir", bare, "update-server-info"], { stdio: "ignore" });
  let held = false, hold = false, requests = 0, heldPath: string | undefined;
  const counts = new Map<string, number>(), unavailable = new Set<string>(), redirects = new Map<string, string>();
  const pending = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    requests++;
    const url = new URL(request.url!, "http://127.0.0.1"), repository = paths.find((path) => url.pathname.startsWith(`${path}/`));
    if (!repository) { response.writeHead(404).end(); return; }
    counts.set(repository, (counts.get(repository) ?? 0) + 1);
    if (unavailable.has(repository)) { response.writeHead(401).end("Generated repository requires explicit authentication."); return; }
    if (redirects.has(repository)) { response.writeHead(301, { Location: `${redirects.get(repository)}${url.pathname.slice(repository.length)}${url.search}` }).end(); return; }
    const path = resolve(bare, `.${url.pathname.slice(repository.length)}`);
    if (!path.startsWith(`${bare}${sep}`)) { response.writeHead(404).end(); return; }
    if (hold && (!heldPath || heldPath === repository) && path.includes(`${sep}objects${sep}`)) { held = true; pending.add(response); response.on("close", () => pending.delete(response)); return; }
    void readFile(path).then((data) => response.writeHead(200, { "Content-Type": "application/octet-stream" }).end(data),
      () => response.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Generated clone server did not bind.");
  const url = (path: string) => `http://127.0.0.1:${address.port}${path}`;
  return { directory, repository: url(paths[0]!), repositories: paths.map(url), url,
    unavailable: (path: string) => unavailable.add(path), redirect: (from: string, to: string) => redirects.set(from, to),
    hold: (path?: string) => { hold = true; heldPath = path; }, held: () => held, requests: () => requests, requestsFor: (path: string) => counts.get(path) ?? 0,
    close: async () => { for (const response of pending) response.destroy(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}
