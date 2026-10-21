import { execFile, spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { RemoteTarget } from "../../packages/protocol/src/index.ts";

const execute = promisify(execFile);
export async function createSshTarget(directory: string): Promise<{ target: RemoteTarget; incorrectHostKey: string; close(): Promise<void> }> {
  const root = await realpath(directory);
  for (const name of ["host", "client", "incorrect-host"]) await execute("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, name)], { timeout: 5000 });
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Generated SSH port could not be allocated.");
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const config = join(root, "sshd.conf");
  await writeFile(config, [
    `Port ${address.port}`, "ListenAddress 127.0.0.1", `HostKey "${join(root, "host")}"`,
    `PidFile "${join(root, "sshd.pid")}"`, `AuthorizedKeysFile "${join(root, "client.pub")}"`,
    "PasswordAuthentication no", "KbdInteractiveAuthentication no", "UsePAM no",
    "AuthenticationMethods publickey", "PermitRootLogin no", "AllowAgentForwarding no",
    "AllowTcpForwarding no", "PermitTunnel no", "X11Forwarding no", "PermitUserRC no", "PrintMotd no", "LogLevel ERROR",
  ].join("\n"), { mode: 0o600 });
  const daemon = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", config], { stdio: ["ignore", "ignore", "pipe"] });
  let ended = false, failure = "";
  const done = new Promise<void>((resolve) => { daemon.once("error", (error) => { failure = error.message; ended = true; resolve(); }); daemon.once("exit", () => { ended = true; resolve(); }); });
  daemon.stderr.on("data", (data: Buffer) => { failure = (failure + data.toString()).slice(-4096); });
  const close = async () => {
    if (ended) return;
    daemon.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([done, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]); clearTimeout(timer);
    if (!ended) { daemon.kill("SIGKILL"); await done; }
  };
  let ready = false;
  for (let index = 0; index < 100 && !ended; index++) {
    ready = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: address.port });
      socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false));
    });
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!ready) { await close(); throw new Error(`Generated SSH server failed: ${failure}`); }
  return {
    target: {
      id: "generated-ssh", name: "Generated loopback SSH", host: "127.0.0.1", port: address.port, user: userInfo().username,
      hostKey: (await readFile(join(root, "host.pub"), "utf8")).trim().split(" ").slice(0, 2).join(" "),
      identityFile: join(root, "client"), stateDir: join(root, "remote-runs"),
      command: [process.execPath, "--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("apps/service/src/remote-bridge.ts")],
      allowCopilot: true, models: [],
    },
    incorrectHostKey: (await readFile(join(root, "incorrect-host.pub"), "utf8")).trim().split(" ").slice(0, 2).join(" "), close,
  };
}
