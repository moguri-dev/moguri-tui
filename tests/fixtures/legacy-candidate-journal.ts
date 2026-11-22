import type { EventStore } from "@moguri-dev/sdk/testing";
import type { EventInput } from "@moguri-dev/sdk/testing";

export function legacyCandidateJournal(store: EventStore): () => void {
  if (store.events().some((event) => ["candidate.saved", "candidate.generation_recorded", "candidate.owner_bound", "candidate.cleanup_recorded", "candidate.usage_retained"].includes(event.event_type))) {
    throw new Error("Select the pre-57 journal before generating candidate history. Existing current records cannot become a legacy fixture.");
  }
  // Keep actual worker/model evidence, encoding the old journal before its first write.
  const encode = (inputs: EventInput[]): EventInput[] => inputs.flatMap((input): EventInput[] => {
    if (input.event_type === "candidate.owner_bound") return [];
    if (input.event_type === "candidate.cleanup_recorded" || input.event_type === "candidate.usage_retained" ||
      input.event_type === "artifact.deleted" && input.payload.candidateIntents) {
      throw new Error("A pre-57 journal fixture cannot perform current candidate cleanup.");
    }
    if (input.event_type === "model.completed" && input.payload.candidateGenerationId) {
      const { candidateGenerationId: _, ...payload } = input.payload;
      return [{ ...input, payload }];
    }
    return [input];
  });
  const original = store.commit;
  store.commit = (inputs, receipt, forget, derive) => original.call(store, encode(inputs), receipt, forget,
    derive ? (events) => encode(derive(events)) : undefined);
  return () => { store.commit = original; };
}
