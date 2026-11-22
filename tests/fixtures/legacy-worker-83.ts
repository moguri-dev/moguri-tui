import { pathToFileURL } from "node:url";
import { isRecord } from "@moguri-dev/sdk";
import { sdkPath } from "./sdk-paths.ts";

let ready = false;
const buffered: unknown[] = [];
process.on("message", (message: unknown) => {
  if (isRecord(message) && message.kind === "start") {
    delete message.retainModelRequests;
    delete message.retry;
  }
  if (!ready && process.listenerCount("message") === 1) buffered.push(message);
});
await import(pathToFileURL(sdkPath("dist/worker.mjs")).href);
ready = true;
for (const message of buffered) process.emit("message", message);
