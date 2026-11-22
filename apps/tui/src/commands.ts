import { slashCommands, tuiSlashCommands } from "@moguri-dev/sdk";

export const tuiTabs = [
  { id: "session", label: "Current session", compact: "Chat", command: "/session" },
  { id: "sessions", label: "Sessions", compact: "Chats", command: "/sessions" },
  { id: "work-items", label: "Work items", compact: "Work", command: "/work-items" },
  { id: "code-requests", label: "Code requests", compact: "Code", command: "/code-requests" },
  { id: "my-work", label: "My Work", compact: "Inbox", command: "/my-work" },
  { id: "automations", label: "Automations", compact: "Auto", command: "F9" },
] as const;
export type TuiTab = typeof tuiTabs[number]["id"];
interface TuiCommand { name: string; description: string; argument?: string }
const localCommands: readonly TuiCommand[] = tuiSlashCommands;
export const tuiCommands: readonly TuiCommand[] = [
  ...localCommands,
  ...slashCommands.filter((entry) => !localCommands.some((local) => local.name === entry.name)),
];
export function tuiCommandSuggestions(text: string): readonly TuiCommand[] {
  if (!/^\/[a-z-]*$/.test(text)) return [];
  return tuiCommands.filter((entry) => entry.name.startsWith(text.slice(1))).slice(0, 6);
}
