import { EventStore } from "../../apps/service/src/store.ts";
import type { EventInput } from "../../packages/protocol/src/index.ts";

export function legacyCheckpointJournal(store: EventStore): () => void {
  const future = (event: EventInput) => event.event_type.startsWith("checkpoint.") || event.event_type.startsWith("rewind.") ||
    ["skill.admission_recorded", "skill.consumed", "session.rewound"].includes(event.event_type) ||
    event.event_type === "sandbox.workspace_recorded" && [4, 5].includes(event.payload.workspace.preparation?.version ?? 0);
  if (store.events().some(future)) throw new Error("Choose the pre-98 journal before its first turn. Current capture/admission history cannot become a legacy fixture.");
  const encode = (inputs: EventInput[]): EventInput[] => inputs.filter((input) => {
    if (input.event_type === "checkpoint.recorded") return false;
    if (future(input) || ["turn.started", "turn.control_started", "turn.retry_started"].includes(input.event_type) &&
      Object.hasOwn(input.payload, "checkpointCaptureId")) throw new Error("A pre-98 fixture cannot perform current source admission, transport capture or rewind effects.");
    return true;
  });
  const original = EventStore.prototype.commit;
  EventStore.prototype.commit = function(inputs, receipt, forget, derive) {
    return this.path === store.path ? original.call(this, encode(inputs), receipt, forget,
      derive ? (events) => encode(derive(events)) : undefined) : original.call(this, inputs, receipt, forget, derive);
  };
  return () => { EventStore.prototype.commit = original; };
}
