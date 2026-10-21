import { execFileSync } from "node:child_process";

export function initializeGeneratedRepository(path: string, files = ["fixture.txt"]) {
  const git = (args: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--initial-branch=main"]); git(["add", "--", ...files]);
  git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated managed workspace base"]);
  return git;
}
