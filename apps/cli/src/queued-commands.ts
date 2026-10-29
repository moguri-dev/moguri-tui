import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { DraftEditor, commandViewKey, parseSlash, terminalCommandExecution, type MoguriSdk, type CommandViewHandler } from "../../../packages/sdk/src/index.ts";
import { saveArtifactExport } from "../../../packages/sdk/src/node.ts";

export async function queuedSlash(sdk: MoguriSdk, sessionId: string, text: string, options: { hold?: boolean; json?: boolean }, output: (value: unknown) => void): Promise<void> {
  const snapshot = sdk.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId), parsed = parseSlash(text);
  if (!session || !parsed) throw new Error("Choose an actual session and one complete slash command. No ordinary model prompt was substituted.");
  const restore = session.status === "archived" && parsed.name === "restore" && !parsed.argument;
  if (!restore && session.draft.text && session.draft.text !== text) throw new Error("Another draft is saved. CLI slash intake never overwrites unrelated unsent text.");
  const earlier = Boolean(session.turnId || session.queue.some((item) => !item.held && item.delivery !== "steer") ||
    snapshot?.commandExecutions.some((entry) => entry.sessionId === session.id && !terminalCommandExecution(entry.status)));
  const editor = new DraftEditor(sdk, session.id, session.draft);
  let printed = false;
  const display = async (value: unknown) => {
    output(value);
    await new Promise<void>((resolve, reject) => process.stdout.write("", (error) => error ? reject(error) : resolve()));
    printed = true;
  };
  try {
    if (!restore) editor.edit(text);
    const intake = restore ? await sdk.commands.restore(session.id, "cli", session.revision, Boolean(options.hold)) :
      await editor.submit((expectedDraftRevision) => sdk.commands.submit(session.id, { client: "cli", expectedDraftRevision, ...(options.hold ? { held: true } : {}) }));
    if (!intake.id) throw new Error("The service did not identify this original input. Inspect its actual queue before retrying.");
    if (!options.hold && ["stop", "approve", "yolo"].includes(parsed.name)) {
      output({ ...intake, live: parsed.name, controls: sdk.getState().snapshot?.sessions.find((entry) => entry.id === session.id)?.controls });
      return;
    }
    if (options.hold || earlier) { output({ ...intake, queued: true, held: Boolean(options.hold), diagnostic: "Accepted into the existing service queue, not claimed executed. Service-capable commands can finish after this CLI closes." }); return; }
    const handlers: Record<string, CommandViewHandler> = {
      profile: async ({ result }) => {
        if (result.kind !== "profile") throw new Error("The exact queued profile response changed type.");
        const selected = await sdk.profiles.open(result.profileId);
        try {
          if (selected.profileId !== result.profileId || selected.getState().status !== "connected") throw new Error("The requested isolated CLI profile did not open. No replacement profile was used.");
          await display(result); return { outcome: "completed" };
        } finally { selected.disconnect(); }
      },
      export: async ({ result }) => {
        if (result.kind !== "export" || !result.path) throw new Error("This CLI export needs its explicitly selected new destination path.");
        await display(await saveArtifactExport(result.path, result.document)); return { outcome: "completed" };
      },
    };
    if (process.stdin.isTTY && !options.json) handlers["continue-work"] = async (context) => {
      if (context.result.kind !== "continue-work") throw new Error("The original continuation result changed type.");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await prompt.question("Continue work: [k] Kanban, [m] send this original input to model, [c] cancel: ", { signal: context.signal })).trim().toLowerCase();
        if (answer === "c" || !answer) return { outcome: "cancelled", restoreInput: true, diagnostic: "The actual user cancelled this exact CLI continuation." };
        if (answer !== "k" && answer !== "m") return { outcome: "failed", diagnostic: "The actual CLI answer was not k, m or c. No route was chosen." };
        await sdk.commands.choose(context.clientId, context.claim, answer === "k" ? "kanban" : "prompt");
        await display({ executionId: context.execution.id, choice: answer === "k" ? "kanban" : "prompt", actor: "user" });
        return { outcome: "completed" };
      } finally { prompt.close(); }
    };
    const errors: Error[] = [], attached = await sdk.commands.attach("cli", handlers, {
      canApply: (entry) => entry.sessionId === session.id && entry.queueItemId === intake.id, onError: (error) => errors.push(error),
    });
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        await sdk.refresh();
        const execution = sdk.getState().snapshot?.commandExecutions.find((entry) => entry.queueItemId === intake.id && entry.sessionId === session.id);
        if (execution && terminalCommandExecution(execution.status)) {
          const retained = await sdk.commands.read(execution.id);
          if (execution.status !== "completed") throw new Error(execution.diagnostic ?? `Original command ${execution.status}; no replacement was executed.`);
          if (!printed) await display(retained.result);
          return;
        }
        if (execution?.status === "waiting-client") {
          const retained = await sdk.commands.read(execution.id);
          if (retained.result && !handlers[commandViewKey(retained.result)]) {
            output({ status: "waiting-client", executionId: execution.id, result: retained.result,
              diagnostic: "This CLI has no actual compatible view handler. Nothing was acknowledged or sent to a model. Inspect commands read/list; use an actual supported client action, not an automatic retry." });
            return;
          }
        }
        if (errors.length) throw errors[0];
        if (Date.now() >= deadline) {
          output({ id: intake.id, queued: true, diagnostic: "Original work is still retained. This bounded CLI wait ended without cancelling or replaying it. Inspect commands list/read." });
          return;
        }
        await delay(25);
      }
    } finally { await attached.dispose(); }
  } finally { editor.dispose(); }
}
