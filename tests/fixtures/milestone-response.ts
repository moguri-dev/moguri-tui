import type { MilestoneCell } from "./milestone-combinations.ts";

export function milestoneResponder(configuration: {
  selection: MilestoneCell["selection"]; autonomy: MilestoneCell["autonomy"]; solverId: string; documentId?: string; question?: boolean;
}) {
  let reviews = 0;
  return (request: Record<string, unknown>): { text?: string; tool?: { name: string; args: Record<string, unknown> } } => {
    const messages = request.messages;
    if (!Array.isArray(messages)) throw new Error("Generated milestone request omitted its actual messages.");
    const system = messages.find((message) => message.role === "system")?.content;
    if (typeof system !== "string") throw new Error("Generated milestone request omitted its actual system message.");
    if (request.model !== configuration.solverId) {
      if (system.includes("Evaluate only the supplied state and named System One-style questions")) return {
        text: JSON.stringify({ answers: { action: {
          type: "choice", choice: "option1", confidence: 0.98, probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 },
        } } }),
      };
      if (system.includes("You classify a Moguri task for an explicitly approved Single workflow")) return {
        text: JSON.stringify({ pattern: "single", modelId: configuration.solverId, confidence: 1,
          reason: "GENERATED_MATRIX_ROUTER_REASON_NOT_SOLVER_CONTEXT" }),
      };
      if (system.includes("Choose the least complex eligible Kupo workflow")) return { text: JSON.stringify({
        pattern: configuration.selection, modelId: configuration.solverId, complexity: "moderate", taskKind: "substantive", confidence: 1,
        reason: "GENERATED_MATRIX_ROUTER_REASON_NOT_SOLVER_CONTEXT",
        ...(configuration.selection === "cascade" ? { escalationId: request.model } : { criticId: request.model }),
      }) };
      if (system.includes("Review the proposed Kupo response") || system.includes("Critique the proposed Kupo response")) {
        reviews++;
        return { text: JSON.stringify({
          verdict: reviews % 2 === 1 ? configuration.selection === "cascade" ? "escalate" : "revise" : "pass",
          reason: "Generated untrusted gate advice, never source acceptance or permission.",
        }) };
      }
    }
    if (configuration.question && !messages.some((message) => message.role === "tool")) return {
      tool: { name: "ask_user", args: {
        question: "Choose a generated matrix approach?", choices: ["Generated first choice", "Generated second choice"], allowFreeform: false,
        ...(configuration.autonomy === "Guided" ? {
          recommendation: { choiceIndex: 1, reason: "Generated selected solver recommendation, not a human answer." },
        } : {}),
      } },
    };
    const hasDocumentResult = messages.some((message) => message.role === "tool" &&
      typeof message.content === "string" && message.content.includes("GENERATED_DOCUMENT_SECRET"));
    return configuration.documentId && !hasDocumentResult ?
      { tool: { name: "read_document", args: { attachmentId: configuration.documentId, section: 2, limit: 512 } } } :
      { text: "Generated selected milestone response." };
  };
}
