import { EventEmitter } from "node:events";
import type { TestContext } from "node:test";
import { isRecord } from "@moguri-dev/sdk/testing";
import type { RemoteRuntime } from "@moguri-dev/sdk/testing";
import type { WorkerConnectionEvents } from "@moguri-dev/sdk/testing";
import type { WorkerConnection, WorkerFrame } from "@moguri-dev/sdk/testing";

export function createRemoteFrameGate(kind: string, onHold?: (frame: WorkerFrame | undefined) => void, accepts?: (request: unknown) => boolean) {
  let holding = false, enabled = true;
  const saved: Array<{ events: EventEmitter<WorkerConnectionEvents>; arguments: WorkerConnectionEvents["message"] }> = [];
  const wrap = (connection: WorkerConnection): WorkerConnection => {
    const events = new EventEmitter<WorkerConnectionEvents>();
    connection.events.on("message", (...message) => {
      if (enabled && !holding && isRecord(message[0]) && message[0].kind === kind && (!accepts || accepts(message[0]))) { holding = true; onHold?.(message[1]); }
      if (holding) saved.push({ events, arguments: message }); else events.emit("message", ...message);
    });
    connection.events.on("error", (error) => events.emit("error", error));
    connection.events.on("exit", (code, signal) => events.emit("exit", code, signal));
    connection.events.on("stderr", (text) => events.emit("stderr", text));
    return { events, get connected() { return connection.connected; },
      send: connection.send.bind(connection), kill: connection.kill.bind(connection),
      acknowledge: (sequence: number) => connection.acknowledge?.(sequence) };
  };
  return { wrap, get held() { return saved.length > 0; }, release: () => {
    holding = false; enabled = false;
    for (const message of saved.splice(0)) message.events.emit("message", ...message.arguments);
  } };
}
export function holdRemoteFrame(t: TestContext, runtime: RemoteRuntime, kind: string, accepts?: (request: unknown) => boolean) {
  const gate = createRemoteFrameGate(kind, undefined, accepts), launch = runtime.launch.bind(runtime);
  const mock = t.mock.method(runtime, "launch", (...args: Parameters<typeof launch>) => gate.wrap(launch(...args)));
  return { get held() { return gate.held; }, release: gate.release, restore: () => mock.mock.restore() };
}
