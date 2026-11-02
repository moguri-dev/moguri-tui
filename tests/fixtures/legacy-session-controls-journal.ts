import { EventStore } from "../../apps/service/src/store.ts";
import { hasSessionControlsHistory, type EventInput } from "../../packages/protocol/src/index.ts";

export function legacySessionControlsJournal(store: EventStore, allViews = false): () => void {
  if (hasSessionControlsHistory(store.events())) throw new Error("Select the pre-87 journal before generating session/tool history. Existing current records cannot become a legacy fixture.");
  const encode = (inputs: EventInput[]): EventInput[] => {
    const events = inputs.map((input): EventInput => {
      if (input.event_type !== "settings.updated") return input;
      const settings = structuredClone(input.payload.settings);
      delete settings.voice.enabled; delete settings.voice.standby;
      delete settings.retention.confirmBulkArchive; delete settings.retention.confirmBulkDelete;
      return { ...input, payload: { ...input.payload, settings } };
    });
    if (hasSessionControlsHistory(events)) throw new Error("A pre-87 journal fixture cannot perform current session/tool/voice effects.");
    return events;
  };
  if (allViews) {
    const original = EventStore.prototype.commit;
    EventStore.prototype.commit = function(inputs, receipt, forget, derive) {
      return this.path === store.path ? original.call(this, encode(inputs), receipt, forget,
        derive ? (events) => encode(derive(events)) : undefined) : original.call(this, inputs, receipt, forget, derive);
    };
    return () => { EventStore.prototype.commit = original; };
  }
  const original = store.commit;
  store.commit = (inputs, receipt, forget, derive) => original.call(store, encode(inputs), receipt, forget,
    derive ? (events) => encode(derive(events)) : undefined);
  return () => { store.commit = original; };
}
