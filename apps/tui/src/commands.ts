import { slashCommands } from "../../../packages/sdk/src/index.ts";

export const tuiTabs = [
  { id: "session", label: "Current session", command: "/session" },
  { id: "sessions", label: "Sessions", command: "/sessions" },
  { id: "work-items", label: "Work items", command: "/work-items" },
  { id: "code-requests", label: "Code requests", command: "/code-requests" },
] as const;
export type TuiTab = typeof tuiTabs[number]["id"];
interface TuiCommand { name: string; description: string; argument?: string }
const localCommands: readonly TuiCommand[] = [
  { name: "session", description: "Return to the current session without sending its draft" },
  { name: "sessions", description: "Choose an existing session" },
  { name: "work-items", description: "Choose a project Kanban card or explicitly browse issues" },
  { name: "code-requests", description: "Review session-linked PRs, code changes or explicitly browse project PRs" },
  { name: "sidebar", description: "Focus navigation, open or close the session sidebar", argument: "[open|close]" },
  { name: "new", description: "Create an idle chat in this project, or without a project", argument: "[global]" },
  { name: "open", description: "Open an explicit local project", argument: "ABSOLUTE_PATH" },
  { name: "connect", description: "Start the explicit Copilot sign-in flow" },
  { name: "cancel-login", description: "Cancel the current sign-in flow" },
  { name: "disconnect", description: "Disconnect Copilot" },
  { name: "stop", description: "Stop this turn and hold undispatched prompts" },
  { name: "steer", description: "Steer the active turn with exact text", argument: "TEXT" },
  { name: "interrupt", description: "Interrupt the active turn with exact text", argument: "TEXT" },
  { name: "resume", description: "Resume admission of queued prompts" },
  { name: "archive", description: "Review archiving this session and its children" },
  { name: "restore", description: "Restore this archived session" },
  { name: "issues", description: "Open this project's local Kanban" },
  { name: "issue", description: "Create or edit a local issue", argument: "new|edit ID" },
  { name: "board", description: "Inspect or edit the shared project board", argument: "[edit|refresh]" },
  { name: "trace", description: "Read actual session events" },
  { name: "details", description: "Toggle full session message details" },
  { name: "reload-draft", description: "Explicitly replace local draft edits with the saved version" },
  { name: "keep-draft", description: "Explicitly keep your draft after a conflict" },
  { name: "quit", description: "Save drafts and leave this TUI" },
];
export const tuiCommands: readonly TuiCommand[] = [
  ...localCommands,
  ...slashCommands.filter((entry) => !localCommands.some((local) => local.name === entry.name)),
];
export function tuiCommandSuggestions(text: string): readonly TuiCommand[] {
  if (!/^\/[a-z-]*$/.test(text)) return [];
  return tuiCommands.filter((entry) => entry.name.startsWith(text.slice(1))).slice(0, 6);
}
