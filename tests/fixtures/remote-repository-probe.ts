import { isRecord, MoguriError } from "@moguri-dev/sdk/testing";
import { readRepositoryCli } from "@moguri-dev/sdk/testing";
import { JsonLineChannel } from "@moguri-dev/sdk/testing";

const wire = new JsonLineChannel(process.stdin, process.stdout), abort = new AbortController();
let admitted = false;
const stop = () => abort.abort(new Error("Generated Remote repository control stopped."));
process.once("SIGTERM", stop); process.once("SIGHUP", stop);
wire.on("error", stop); wire.on("close", () => { stop(); process.stdin.destroy(); });
wire.on("message", (request: unknown) => {
  if (admitted || !isRecord(request) || typeof request.root !== "string" || typeof request.repository !== "string") { process.exitCode = 1; wire.end(); return; }
  admitted = true;
  void readRepositoryCli(request.root, request.repository, abort.signal).then(
    (repository) => wire.send({ kind: "repository", repository }, () => wire.end()),
    (error: unknown) => wire.send({ kind: "error", code: error instanceof MoguriError ? error.code : "generated_probe", message: error instanceof MoguriError ? error.message : "Generated repository probe failed." }, () => wire.end()),
  );
});
