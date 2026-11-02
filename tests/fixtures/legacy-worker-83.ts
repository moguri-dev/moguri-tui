import { isRecord } from "../../packages/protocol/src/index.ts";

let ready = false;
const buffered: unknown[] = [];
process.on("message", (message: unknown) => {
  if (isRecord(message) && message.kind === "start") {
    delete message.retainModelRequests;
    delete message.retry;
  }
  if (!ready && process.listenerCount("message") === 1) buffered.push(message);
});
await import("../../apps/service/src/worker.ts");
ready = true;
for (const message of buffered) process.emit("message", message);
