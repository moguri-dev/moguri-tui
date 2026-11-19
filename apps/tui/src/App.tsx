/** @jsxImportSource @opentui/react */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions, type InputProps, type SelectProps } from "@opentui/react";
import { executeAutomationsCommand, executeOtlpCommand, executeStainlessCommand, effectivePrAutomation, PR_AUTOMATION_LABELS, prAutomationDefaults, prAutomationExceptions, prAutomationSourceLabel } from "../../../packages/sdk/src/index.ts";
import { CliRenderEvents, SyntaxStyle, TextRenderable, type BoxOptions, type CliRendererFrameEvent, type InputRenderable, type TextareaRenderable, type MarkdownOptions, type ScrollBoxRenderable } from "@opentui/core";
import { stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { useMoguri, useSessionActivity, useTaskProgress } from "../../../packages/sdk/src/react.ts";
import { appearanceColors, attachmentStatus, compareSessionPriority, outcomeLabel, progressBar, runningSessionNames, runningSessions, sessionModeLabel, sessionStatusLabel, sessionChildBindings, sessionRepositoryProposal, sessionSubtree, sessionTitle, sessionPullRequest, sessionPullRequestUrl, terminalCommandExecution, themePalettes, type Appearance, type ThemeMode } from "../../../packages/sdk/src/index.ts";
import { agentHarnessProduct, describeActivityCall, hostedProvider, approvalProject, commandFamily, RememberApprovalSchema, type GithubItem, type GithubRepository, type GithubResponse, type GithubScope, type SessionChildrenAction } from "../../../packages/sdk/src/index.ts";
import { continueWorkInput, parseShellCommand, sessionShortId, DraftEditor, pendingInputStatus, parse, pasteLineCount, parseAttachmentTrigger, attachmentTriggers, SettingsSchema, ProjectSettingsSchema, SYSTEM_PROMPT_WARNING, BUDGET_WARNING, ProfileDraftSchema, defaultBoard, IssueInputSchema, BoardConfigSchema, ArtifactDraftSchema, ArtifactChangesSchema, isRecord, type ContinueWorkReview, type PlanEditorRequest, type ArtifactEditorRequest, type ArtifactExport, type MoguriSdk, type Command, type Session, type PublicMessage, type SlashResult, type Profile, type ProfileCatalog } from "../../../packages/sdk/src/index.ts";
import { tuiTabs, tuiCommands, tuiCommandSuggestions, type TuiTab } from "./commands.ts";
import type { CommandClientAttachment, CommandExecution, CommandViewContext, CommandViewOutcome } from "../../../packages/sdk/src/index.ts";
import { configuredReadinessModels, kupoModes, retryFailure, scheduleLocalChoices, scheduleLocalTime, type KupoModeAvailability, type ModelReadinessResponse, type ModelRuntimePreview, type ScheduledPrompt, type ScheduledTiming } from "../../../packages/sdk/src/index.ts";
import { MyWorkFiltersSchema, type MyWorkEntry, type MyWorkFilters, type MyWorkResponse, type Snapshot } from "../../../packages/sdk/src/index.ts";
type MoguriClient = MoguriSdk;

function terminalColors(appearance: Appearance, mode: ThemeMode) {
  const value = appearanceColors(appearance, mode);
  return { background: value.canvas, surface: value.surface, sidebar: value.sidebar, panel: value.selected, selection: value.selectionText,
    foreground: value.text, muted: value.muted, accent: value.accent, border: value.controlLine, error: value.danger, attention: value.warningText };
}
const ThemeContext = React.createContext(terminalColors({ theme: "dark" }, "dark"));
function MyWorkTui({ sdk, snapshot, filters, changeFilters, openSession, openExternal }: {
  sdk: MoguriSdk; snapshot: Snapshot; filters: MyWorkFilters; changeFilters: (filters: MyWorkFilters) => void;
  openSession: (id: string) => Promise<void>; openExternal: (url: string) => Promise<void>;
}) {
  const colors = React.useContext(ThemeContext), [offset, setOffset] = useState(0), [reload, setReload] = useState(0);
  const [data, setData] = useState<{ sdk: MoguriSdk; selectionKey: string; key: string; value?: Extract<MyWorkResponse, { type: "my_work.query" }>; error?: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [original, setOriginal] = useState<string | null>(null), [review, setReview] = useState<{ sourceId: string; value: Extract<MyWorkResponse, { type: "my_work.followup" }> } | null>(null);
  const selectionKey = JSON.stringify([filters, offset, snapshot.myWorkSources, snapshot.policy.revision, snapshot.settings.permissionRevision,
    snapshot.projectConfigurations.map((value) => [value.projectId, value.revision])]);
  const key = JSON.stringify([selectionKey, reload, snapshot.myWorkRefreshes.map((record) => [record.id, record.revision]),
    snapshot.githubOperations.map((record) => [record.id, record.revision])]);
  const current = data?.sdk === sdk && data.selectionKey === selectionKey ? data : null, inbox = current?.value;
  const selected = inbox?.entries.find((entry) => entry.id === selectedId);
  useEffect(() => {
    const abort = new AbortController();
    void sdk.myWork.query(filters, { offset, signal: abort.signal })
      .then((value) => { if (!abort.signal.aborted) setData({ sdk, selectionKey, key, value }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setData({ sdk, selectionKey, key, error: error instanceof Error ? error.message : "The retained inbox is unavailable; no clean result was invented." }); });
    return () => abort.abort();
  }, [sdk, key]);
  const act = async (execute: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await execute(); } catch (error) { setError(error instanceof Error ? error.message : "The exact inbox action failed without success or fallback."); }
    finally { setBusy(false); }
  };
  const filter = (value: MyWorkFilters) => { changeFilters(value); setOffset(0); setSelectedId(null); setOriginal(null); setReview(null); };
  const itemText = (entry: MyWorkEntry) => safe([
    entry.url, `${entry.pull.item.state} / ${entry.freshness} / PR head ${entry.pull.item.headSha} / ${entry.pull.observedAt}`,
    `Reasons: ${entry.categories.join(", ")}; review ${entry.pull.reviewDecision ?? "unobserved"}`,
    entry.conflicting ? "Source heads/state conflict. Original observations are not combined." : "",
    `CI ${entry.pull.ci?.state ?? "unobserved"} / ${entry.pull.ci?.at ?? "not observed"}. No checks or unknown conclusions are not successful CI.`,
    entry.pull.diagnostic ?? "", entry.pull.item.body,
    `Requests: ${entry.pull.requests?.map((request) => `${request.kind}:${request.login}`).join(", ") ?? "unobserved; no team membership guessed"}`,
    ...(entry.pull.threads?.map((thread) => `${thread.resolved ? "resolved" : "unresolved"}${thread.outdated ? " / outdated" : ""}: ${thread.body}\n${thread.url}`) ?? ["Threads unobserved. Comments do not prove resolution."]),
    ...(entry.pull.ci?.items.map((item) => `${item.title}: ${item.state}/${item.conclusion ?? "unknown"}\n${item.body}\n${item.url ?? ""}`) ?? []),
    ...entry.associations.map((source) => `${source.source.accountId} / ${source.source.binding.root.root} / original ${source.pull.item.headSha} / ${source.freshness}\n${source.diagnostic ?? ""}\n${source.watch ? `Retained watch ${source.watch.operationId}: ${source.watch.status}/${source.watch.observation?.state ?? "unobserved"}${source.watch.currentHead ? " / same observed head" : " / different original head; not current CI"}${source.watch.cleanupUnconfirmed ? " / cleanup unconfirmed" : ""}. Never restarted by opening this view.` : ""}`),
    ...entry.associations.flatMap((source) => source.previous ? [`Previous complete report ${source.previous.refreshId}: head ${source.previous.pull.item.headSha} / CI ${source.previous.pull.ci?.state ?? "unobserved"} / ${source.previous.pull.observedAt}. Historical evidence, not a newer or passing head.`] : []),
  ].filter(Boolean).join("\n\n"));
  const options = review ? [
    { name: "Cancel follow-up review", description: "No session, prompt or permission is changed.", value: "review-cancel" },
    { name: "Confirm idle follow-up session", description: "Exact reviewed account/root; saved draft only, normal permissions.", value: "review-start" },
  ] : original ? [{ name: "Return to retained inbox", description: "No refresh or replay.", value: "original-back" }] : selected ? [
    { name: "Back to inbox", description: "Read-only navigation.", value: "back" },
    { name: "Open canonical GitHub PR", description: selected.url, value: "external" },
    { name: "Mark inbox item read", description: "Not resolved, answered or approved.", value: "read" },
    ...selected.associations.flatMap((source) => [
      ...source.sessionIds.map((id) => ({ name: `Open session ${snapshot.sessions.find((session) => session.id === id)?.title ?? id}`, description: source.source.accountId, value: `session:${source.source.id}:${id}` })),
      { name: `Review scoped follow-up / ${source.source.accountId}`, description: source.source.binding.root.root, value: `followup:${source.source.id}` },
      { name: `Read original source report / ${source.source.accountId}`, description: source.refreshId ?? "No observation", value: `original:${source.source.id}` },
    ]),
  ] : [
    ...(inbox?.entries ?? []).map((entry) => ({ name: safe(`${entry.repository}#${entry.number} ${entry.pull.item.title}`),
      description: `${entry.categories.join(", ")} / CI ${entry.pull.ci?.state ?? "unobserved"} / ${entry.freshness}`, value: `item:${entry.id}` })),
    { name: "Reload retained view", description: "No GitHub HTTP read.", value: "reload" },
    { name: "Refresh configured repositories", description: "Explicit read-only refresh; no scheduler or new CI watch.", value: "refresh" },
    { name: "Refresh status and source ownership", description: "Original retained records, no replay.", value: "status" },
    ...snapshot.myWorkRefreshes.filter((record) => record.cleanupUnconfirmed && !record.inspection).map((record) =>
      ({ name: `I inspected original partial refresh ${record.id}`, description: "Read the original report first. Inspection is not cleanup proof or permission.", value: `inspect:${record.id}` })),
    ...(inbox?.refreshing ? [{ name: "Stop original inbox refresh", description: `${inbox.refreshing.id}; CI watches/GitHub jobs are not stopped.`, value: "stop" }] : []),
    { name: "Clear inbox filters", description: "All configured sources; open PRs.", value: "clear" },
    ...(["open-pr", "pending-review", "failed-ci", "unresolved-thread"] as const).map((category) => ({ name: `Filter ${category}`, description: "Actual provider state, not model guesses.", value: `category:${category}` })),
    ...[...new Set(snapshot.myWorkSources.filter((source) => source.enabled).map((source) => source.repository))].map((repository) =>
      ({ name: `Repository ${repository}`, description: "Configured sources only.", value: `repository:${repository}` })),
    ...[...new Set(snapshot.myWorkSources.filter((source) => source.enabled).map((source) => source.accountId))].map((account) =>
      ({ name: `Account ${account}`, description: "No account/root substitution.", value: `account:${account}` })),
    ...(offset > 0 ? [{ name: "Previous work page", description: "Retained pagination.", value: "previous" }] : []),
    ...(inbox && offset + 30 < inbox.total ? [{ name: "Next work page", description: "Retained pagination.", value: "next" }] : []),
  ];
  return <box id={current?.key === key ? `tui-my-work-${sdk.profileId}` : undefined} flexDirection="column" flexGrow={1} paddingTop={1} gap={1}>
    <text fg={colors.accent} height={2}>{safe(`My Work / ${sdk.profileId} / controller GitHub account, not SSH`)}</text>
    <text fg={colors.muted} height={3}>{safe(`${inbox ? `${inbox.total} matching PRs; ${inbox.refreshing ? "refresh running" : "retained view only"}` : "Reading retained observations..."}\n/my-work source reviews a Local source; /my-work configure SHA confirm-read-only saves it. Esc returns without cancelling work.`)}</text>
    {current?.error && <text fg={colors.error}>{safe(current.error)}</text>}{error && <text fg={colors.error}>{safe(error)}</text>}{notice && <text fg={colors.attention}>{safe(notice)}</text>}
    {inbox && current?.key !== key && <text fg={colors.attention}>Updating retained view; previous observations are not current CI proof.</text>}
    {!selected && !review && !original && <text fg={colors.attention} height={Math.min(8, Math.max(2, (inbox?.sources.length ?? 0) * 2))}>{safe(inbox?.sources.length ?
      inbox.sources.map((source) => `${source.source.repository} / ${source.source.accountId} / ${source.freshness}\n${source.diagnostic ?? source.observedAt ?? "Unobserved; cannot confirm a clean inbox."}`).join("\n") :
      "No explicit sources or observations. An empty/unavailable source is not a clean inbox. Inspect Refresh status for every original source.")}</text>}
    {(selected || review || original) && <scrollbox flexGrow={1}><text fg={colors.foreground}>{original ?? (review ?
      safe(`${review.value.item.title}\n\n${review.value.item.body}\n\n${review.value.warning}`) : itemText(selected!))}</text></scrollbox>}
    <ThemedSelect key={review ? "review" : original ? "original" : selected?.id ?? "inbox"} id="tui-my-work-actions" focused={!busy} flexGrow={selected || review || original ? 0 : 1} height={selected || review || original ? 9 : undefined} options={options} onSelect={(_, option) => {
      if (!option) return; const value = String(option.value);
      void act(async () => {
        if (value === "back") { setSelectedId(null); return; }
        if (value === "review-cancel") { setReview(null); return; }
        if (value === "original-back") { setOriginal(null); return; }
        if (value === "reload") { setReload((value) => value + 1); return; }
        if (value === "clear") { filter({}); return; }
        if (value === "previous" || value === "next") { setOffset((offset) => Math.max(0, offset + (value === "next" ? 30 : -30))); return; }
        if (value === "refresh") { const result = await sdk.myWork.refresh(); setNotice(`Original refresh admitted: ${result.id}. Not CI success.`); return; }
        if (value === "status") { setOriginal(safe(JSON.stringify(await sdk.myWork.status(), null, 2))); return; }
        if (value.startsWith("inspect:")) {
          const record = snapshot.myWorkRefreshes.find((record) => record.id === value.slice(8));
          if (!record) throw new Error("The exact original reader is unavailable.");
          await sdk.myWork.inspect(record.id, record.revision, record.inputDigest, true); setNotice("Original partial reader inspected; cleanup remains unconfirmed. Refresh separately."); return;
        }
        if (value === "stop" && inbox?.refreshing) { await sdk.myWork.cancel(inbox.refreshing.id); setNotice("Original inbox refresh stopped; retained partial work stays visible. No CI watch was cancelled."); return; }
        if (value.startsWith("item:")) { setSelectedId(value.slice(5)); return; }
        if (value.startsWith("category:")) { filter({ ...filters, category: parse(MyWorkFiltersSchema, { category: value.slice(9) }).category }); return; }
        if (value.startsWith("repository:")) { filter({ ...filters, repository: value.slice(11) }); return; }
        if (value.startsWith("account:")) { filter({ ...filters, accountId: value.slice(8) }); return; }
        if (value === "review-start" && review) { const result = await sdk.myWork.start(review.value, review.sourceId, true); setReview(null); await openSession(result.id!); return; }
        if (!selected) throw new Error("The exact retained item changed; no replacement selection was used.");
        if (value === "external") { await openExternal(selected.url); return; }
        if (value === "read") { await sdk.myWork.markRead(selected.id); setNotice("Marked read, not resolved or approved."); return; }
        if (value.startsWith("followup:")) { const sourceId = value.slice(9); setReview({ sourceId, value: await sdk.myWork.previewFollowup(selected.id, sourceId) }); return; }
        if (value.startsWith("original:")) {
          const association = selected.associations.find((source) => source.source.id === value.slice(9));
          if (!association?.refreshId) throw new Error("The original source report is unobserved.");
          setOriginal(safe(JSON.stringify(await sdk.myWork.read(association.refreshId, { sourceId: association.source.id }), null, 2))); return;
        }
        if (value.startsWith("session:")) {
          const [, sourceId, sessionId] = value.split(":"); if (!sourceId || !sessionId) throw new Error("Choose the exact session association.");
          const target = await sdk.myWork.navigate(selected.id, sourceId);
          if (!target.navigation.sessionIds.includes(sessionId)) throw new Error("The exact related session changed; no replacement was chosen.");
          await openSession(sessionId); return;
        }
        throw new Error("The exact inbox action is unavailable; no success was inferred.");
      });
    }} />
  </box>;
}
const NavigationContext = React.createContext(false);
const safe = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
function TerminalAlert({ text, error, keyboard }: { text: string; error: boolean; keyboard: boolean }) {
  const colors = React.useContext(ThemeContext), [dismissed, setDismissed] = useState(false);
  useKeyboard((key) => {
    if (!dismissed && keyboard && !key.defaultPrevented && key.name === "escape") {
      key.preventDefault(); key.stopPropagation(); setDismissed(true);
    }
  });
  if (dismissed) return null;
  return <box flexDirection="row" flexShrink={0}>
    <text id={error ? "tui-alert-error" : "tui-alert-info"} fg={error ? colors.error : colors.muted} flexGrow={1}>{safe(text)}</text>
    <box id="tui-alert-dismiss" width={5} height={1} onMouseDown={(event) => {
      if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); setDismissed(true);
    }}><text fg={colors.muted}>[x]</text></box>
  </box>;
}
export async function waitForCommandFrame(renderer: ReturnType<typeof useRenderer>, signal: AbortSignal, applied: () => boolean): Promise<void> {
  const deadline = AbortSignal.timeout(10_000), owner = AbortSignal.any([signal, deadline]), originalFrame = renderer.frameId;
  let presented = false;
  const observed = (frame: CliRendererFrameEvent) => {
    if (!owner.aborted && !renderer.isDestroyed && frame.frameId > originalFrame && applied()) presented = true;
  };
  renderer.on(CliRenderEvents.FRAME, observed);
  try {
    for (;;) {
      owner.throwIfAborted();
      if (renderer.isDestroyed) throw new Error("The original terminal closed before acknowledging its queued view.");
      await delay(0, undefined, { signal: owner });
      renderer.requestRender();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(owner.reason);
        owner.addEventListener("abort", abort, { once: true });
        if (owner.aborted) { owner.removeEventListener("abort", abort); abort(); return; }
        void renderer.idle().then(() => { owner.removeEventListener("abort", abort); resolve(); },
          (error: unknown) => { owner.removeEventListener("abort", abort); reject(error); });
      });
      owner.throwIfAborted();
      if (presented || renderer.frameId > originalFrame && applied()) return;
      await delay(15, undefined, { signal: owner });
    }
  } finally { renderer.off(CliRenderEvents.FRAME, observed); }
}
const label = (session: Session) => sessionTitle(session, 44);
const NO_REGISTRY: Pick<Snapshot, "registry"> = { registry: [] };
type Mode = "compose" | "project" | "sessions" | "models" | "queue" | "trace" | "command-results" | "help" | "approval" | "approval-choices" | "github-repositories" | "github-clone" | "github-items" | "github-detail" | "my-work" | "session-action" | "settings" | "themes" | "prompt-editor" | "settings-editor" | "project-editor" | "capability-output" | "runtime-review" | "mcp-token" | "issues" | "work-items" | "code-requests" | "issue-editor" | "board-editor" | "artifacts" | "artifact-editor" | "question" | "profiles" | "profile-editor" | "profile-recovery" | "plan-editor" | "continue-work" | "schedule" | "automations" | "kupo-mode" | "repository-import";
const editorModes: Mode[] = ["prompt-editor", "settings-editor", "project-editor", "issue-editor", "board-editor", "artifact-editor", "profile-editor", "plan-editor"];
type ArchiveReview = {
  session: Pick<Session, "id" | "title" | "revision">;
  children: Pick<Session, "id" | "title" | "parentSessionId" | "kind">[];
  expected: ReturnType<typeof sessionChildBindings>;
  canDetach: boolean;
  /** Sessions in the tree whose work archiving stops; the user always confirms these, whatever the saved preference. */
  running: Pick<Session, "id" | "title">[];
};
export interface TuiNativeActions { browser: (url: string) => Promise<void>; file: (path: string) => Promise<void>; copy: (text: string) => Promise<void>; saveExport?: (path: string, document: ArtifactExport) => Promise<{ path: string; digest: string }> }

export function TuiApp({ client: initialClient, onQuit, initialSessionId, native }: { client: MoguriClient; onQuit?: () => void; initialSessionId?: string; native?: TuiNativeActions }) {
  const [client, setClient] = useState(initialClient);
  const clients = useRef(new Set([initialClient]));
  const { snapshot, status, error, events } = useMoguri(client);
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [terminalMode, setTerminalMode] = useState<ThemeMode>(renderer.themeMode ?? "dark");
  useEffect(() => { renderer.on("theme_mode", setTerminalMode); return () => { renderer.off("theme_mode", setTerminalMode); }; }, [renderer]);
  const appearance = snapshot?.settings.values.appearance ?? { theme: "dark" };
  const colors = terminalColors(appearance, appearance.theme === "system" ? terminalMode : appearance.theme);
  const markdownStyle = React.useMemo(() => SyntaxStyle.fromStyles({
    default: { fg: colors.foreground },
    "markup.heading": { fg: colors.accent, bold: true },
    "markup.strong": { fg: colors.foreground, bold: true },
    "markup.italic": { fg: colors.foreground, italic: true },
    "markup.raw": { fg: colors.accent },
    "markup.link.label": { fg: colors.accent, underline: true },
    "markup.link.url": { fg: colors.muted },
    "markup.list": { fg: colors.accent },
  }, renderer.nativeScene), [renderer, colors.foreground, colors.accent, colors.muted]);
  useEffect(() => () => { if (!renderer.nativeScene.resourceContext.disposed) markdownStyle.destroy(); }, [renderer, markdownStyle]);
  const renderMarkdownNode = React.useCallback<NonNullable<MarkdownOptions["renderNode"]>>((token, context) => {
    if (token.type === "code" && typeof token.text === "string") {
      return new TextRenderable(renderer, { content: safe(token.text), fg: colors.accent, bg: colors.surface, paddingX: 1, marginTop: 1, marginBottom: 1 });
    }
    return context.defaultRender();
  }, [renderer, colors.accent, colors.surface]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [mode, renderMode] = useState<Mode>("compose");
  const modeRef = useRef<Mode>("compose");
  const navigationEpoch = useRef(0), submittedViews = useRef(new Map<string, number>());
  const [responsePulse, setResponsePulse] = useState(0);
  const setMode = (value: Mode) => { navigationEpoch.current++; modeRef.current = value; renderMode(value); };
  const [sidebar, setSidebar] = useState<boolean | null>(null);
  const [navigationFocus, renderNavigationFocus] = useState(false), [navigationIndex, renderNavigationIndex] = useState(0);
  // One terminal packet can contain navigation and Enter before React commits focus.
  const navigationFocusRef = useRef(false), navigationIndexRef = useRef(0);
  const setNavigationFocus = (value: boolean) => { navigationFocusRef.current = value; renderNavigationFocus(value); };
  const setNavigationIndex = (value: number) => { navigationIndexRef.current = value; renderNavigationIndex(value); };
  const sidebarVisible = sidebar ?? width >= 100, sidebarOnly = sidebarVisible && width < 80;
  const compact = width < 80 || height < 30;
  const activeTab: TuiTab = mode === "sessions" ? "sessions" : mode === "work-items" || mode === "issues" ? "work-items" : mode === "code-requests" ? "code-requests" : mode === "my-work" ? "my-work" : mode === "automations" ? "automations" : "session";
  const [notice, storeNotice] = useState<{ id: number; text: string; error: boolean } | null>(null), noticeSequence = useRef(0);
  const setNotice = React.useCallback((text: string, error = false) => storeNotice(text ? { id: ++noticeSequence.current, text, error } : null), []);
  const [skillHelp, setSkillHelp] = useState<{ profileId: string; text: string } | null>(null);
  const [continueReview, setContinueReview] = useState<ContinueWorkReview | null>(null);
  const queuedContinue = useRef<{ context: CommandViewContext; pending: boolean; cancelling?: boolean; settle(outcome: CommandViewOutcome): void } | null>(null);
  const [continuePending, setContinuePending] = useState(false);
  const [scheduleInitial, setScheduleInitial] = useState<"ask" | "schedule">("ask"), schedulePending = useRef(false);
  const [kupoOptions, setKupoOptions] = useState<KupoModeAvailability[]>([]), [kupoOptionError, setKupoOptionError] = useState("");
  const [kupoSaving, setKupoSaving] = useState(false), kupoPending = useRef(false);
  const [archiveReview, setArchiveReview] = useState<ArchiveReview | null>(null);
  const queuedArchive = useRef<{ context: CommandViewContext; pending: boolean; settle(outcome: CommandViewOutcome): void } | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [otherQuestion, setOtherQuestion] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const detailedRef = useRef(false);
  const [followTranscript, setFollowTranscript] = useState(true);
  const transcript = useRef<ScrollBoxRenderable>(null);
  const followLatest = () => { setFollowTranscript(true); transcript.current?.scrollTo(transcript.current.scrollHeight); };
  const toggleDetails = () => {
    detailedRef.current = !detailedRef.current; setDetailed(detailedRef.current);
    if (detailedRef.current) setFollowTranscript(false); else followLatest();
  };
  useEffect(() => { setFollowTranscript(true); }, [client, selectedId]);
  const [projectPath, setProjectPath] = useState("");
  const [startupCommand, setStartupCommand] = useState("");
  const [settingsText, setSettingsText] = useState("");
  const settingsRevision = useRef(0);
  const [capabilityOutput, setCapabilityOutput] = useState("");
  const [runtimePreview, setRuntimePreview] = useState<ModelRuntimePreview | null>(null), [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeActionsFocused, setRuntimeActionsFocused] = useState(false);
  const runtimePending = useRef(false), runtimeAbort = useRef<AbortController | null>(null), runtimeOwner = useRef("");
  const [githubRepositories, setGithubRepositories] = useState<Extract<GithubResponse, { type: "github.repositories" }> | null>(null);
  const [githubRepository, setGithubRepository] = useState<GithubRepository | null>(null), [githubCloneJob, setGithubCloneJob] = useState<string | null>(null);
  const [githubItems, setGithubItems] = useState<{ scope: GithubScope; context: Extract<GithubResponse, { type: "github.project" }>; kind: "issue" | "pull"; items: GithubItem[]; nextPage: number | null } | null>(null);
  const [myWorkFilters, setMyWorkFilters] = useState<MyWorkFilters>({});
  const [githubSelection, setGithubSelection] = useState<(Extract<GithubResponse, { type: "github.source" }> & { scope: GithubScope }) | null>(null);
  const [githubBusy, setGithubBusy] = useState(false), githubPending = useRef(false);
  const githubSearch = useRef({ source: "account" as "account" | "public", query: "" });
  const githubOwner = useRef("");
  const [tokenServer, setTokenServer] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [tokenKind, setTokenKind] = useState<"mcp" | "linear" | "model" | "remote-model" | "cache" | "hosted-key" | "hosted-code" | "otlp-header">("mcp");
  const issueEditor = useRef<{ id: string | null; revision: number }>({ id: null, revision: 0 });
  const artifactEditor = useRef<ArtifactEditorRequest | null>(null);
  const planEditor = useRef<PlanEditorRequest | null>(null), planSaving = useRef(false);
  const [planPending, setPlanPending] = useState(false);
  const [profiles, setProfiles] = useState<ProfileCatalog | null>(null);
  const profileEditor = useRef<Profile | null>(null);
  const switchingProfile = useRef(false);
  const [profilePending, setProfilePending] = useState(false);
  const editors = useRef(new Map<string, DraftEditor>());
  useEffect(() => () => { for (const editor of editors.current.values()) editor.dispose(); for (const client of clients.current) client.disconnect(); }, []);
  const session = snapshot?.sessions.find((session) => session.id === selectedId);
  runtimeOwner.current = JSON.stringify([client.profileId, session?.id, session?.workspaceId, session?.sandboxWorkspaceId,
    session?.controls.env, session?.turnId, snapshot?.settings.revision, snapshot?.policy.revision]);
  const runtimeScope = runtimeOwner.current;
  useEffect(() => () => { runtimeAbort.current?.abort(); }, [client, runtimeScope, mode]);
  const retry = session && snapshot ? retryFailure(session, snapshot.modelFailures) : undefined, retryPending = useRef(false);
  githubOwner.current = JSON.stringify([client.profileId, session?.id, session?.projectId, session?.workspaceId, session?.controls.env]);
  const taskProgress = useTaskProgress(client, session, status === "connected");
  const diskId = session?.workspaceId ? snapshot?.managedWorkspaces.find((workspace) => workspace.id === session.workspaceId)?.volume?.diskId : undefined;
  const diskPausedNotice = useRef(false);
  useEffect(() => {
    if (!diskId || status !== "connected") return;
    let active = true;
    void client.application.disk.status().then(({ disk }) => {
      if (!active) return;
      const paused = disk.disk?.id === diskId && Boolean(disk.disk.pressure?.paused), shown = diskPausedNotice.current;
      diskPausedNotice.current = paused;
      if (paused && !shown) setNotice("Moguri's virtual disk is full, so this chat is paused before its next model call. Archive sessions (their clean, pushed worktrees are removed) or use /runtime disk-size GB; work resumes on its own.");
    }, () => undefined);
    return () => { active = false; };
  }, [client, diskId, snapshot, status, setNotice]);
  useEffect(() => {
    if (mode !== "kupo-mode" || !session) return;
    let active = true;
    setKupoOptions([]); setKupoOptionError("");
    void client.routing.modes(session.id).then(({ modes }) => { if (active) setKupoOptions(modes); })
      .catch((error: unknown) => { if (active) setKupoOptionError(error instanceof Error ? error.message : "The actual mode readiness is unavailable."); });
    return () => { active = false; };
  }, [client, mode, session?.id, session?.controls.env, snapshot?.settings.revision]);
  const project = snapshot?.projects.find((project) => project.id === session?.projectId);
  const proposal = sessionRepositoryProposal(session, snapshot);
  const repositoryPrompt = session && proposal && !proposal.project && proposal.confirm ? { sessionId: session.id, revision: session.revision, root: proposal.root.root } : null;
  const importRepository = async (remember: boolean) => {
    if (!repositoryPrompt) throw new Error("This chat no longer proposes a repository. Nothing was imported.");
    await client.sessions.importRepository(repositoryPrompt.sessionId, repositoryPrompt.root, true, repositoryPrompt.revision);
    if (remember) {
      const current = client.settings.get();
      if (!current) throw new Error("The repository was imported, but the preference was not saved. Reconnect and retry.");
      await client.settings.update({ ...current.values, interactions: { ...current.values.interactions, confirmRepositoryImport: false } }, current.revision);
    }
    setMode("compose"); setNotice(`Imported ${repositoryPrompt.root} and moved this chat into it.`);
  };
  const pendingQuestion = snapshot?.questions.find((question) => question.id === session?.pendingQuestionId && question.status === "open");
  const compactDecision = compact && Boolean(session?.pendingApproval || pendingQuestion);
  useEffect(() => { setOtherQuestion(null); }, [client.profileId, pendingQuestion?.id, pendingQuestion?.revision]);
  const recommendation = pendingQuestion?.recommendation;
  const questionDetails = pendingQuestion ? `${pendingQuestion.question}${recommendation ? `\n\nModel recommends: ${recommendation.choice}\n${recommendation.reason}\nFrom ${recommendation.modelId}. Untrusted advice; you still decide.` : ""}` : "";
  const approvalSummary = session?.pendingApproval ? describeActivityCall(session.pendingApproval.call, snapshot ?? NO_REGISTRY) : null;
  const approvalSubject = approvalSummary?.subject && approvalSummary.subject !== session?.pendingApproval?.call.name ? `${approvalSummary.label}: ${approvalSummary.subject}\n\nArguments\n` : "";
  const approvalAdvice = session?.pendingApproval?.recommendationSource?.stepId === session?.pendingApproval?.stepId && session?.pendingApproval?.recommendationSource?.callId === session?.pendingApproval?.call.id ? session?.pendingApproval?.recommendation : undefined;
  const availableModels = snapshot?.provider.models.filter((model) => model.synthetic || !model.environments || model.environments.includes(session?.controls.env ?? "Local")) ?? [];
  const readinessModels = configuredReadinessModels(snapshot?.provider.catalogue, session?.controls.env ?? "Local");
  const board = project ? snapshot?.boards.find((board) => board.projectId === project.id) ?? defaultBoard(project.id) : null;
  const localIssues = snapshot?.issues.filter((issue) => issue.projectId === project?.id && !issue.archived) ?? [];
  const continuedWork = snapshot?.projectWorkRuns.findLast((work) => work.originSessionId === session?.id);
  const editor = React.useMemo(() => {
    if (!session) return null;
    let value = editors.current.get(session.id);
    if (!value) { value = new DraftEditor(client, session.id, session.draft); editors.current.set(session.id, value); }
    return value;
  }, [client, session?.id]);
  useEffect(() => {
    if (snapshot && (!selectedId || !snapshot.sessions.some((session) => session.id === selectedId))) setSelectedId(snapshot.sessions.find((session) => session.status !== "archived")?.id ?? snapshot.sessions[0]?.id ?? null);
    if (snapshot) for (const [id, editor] of editors.current) if (!snapshot.sessions.some((session) => session.id === id)) { editor.dispose(); editors.current.delete(id); }
  }, [snapshot, selectedId]);
  useEffect(() => { if (session && editor) editor.receive(session.draft); }, [session?.draft.revision, editor]);
  const settleContinuationCancellation = () => {
    const owned = queuedContinue.current;
    if (!owned?.cancelling || owned.context.sdk !== client) return;
    const source = client.getState().snapshot?.sessions.find((session) => session.id === owned.context.sessionId);
    if (source) editors.current.get(source.id)?.receive(source.draft);
    queuedContinue.current = null; setContinueReview(null); setContinuePending(false); setMode("compose");
  };
  useEffect(() => {
    const owned = queuedContinue.current;
    if (!owned?.cancelling || owned.context.sdk !== client) return;
    const actual = snapshot?.commandExecutions.find((entry) => entry.id === owned.context.execution.id);
    if (!actual || terminalCommandExecution(actual.status)) settleContinuationCancellation();
  }, [client, snapshot]);
  const perform = async (action: () => Promise<unknown>) => {
    setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Operation failed. The draft is preserved.", true); }
  };
  const command = (command: Command) => perform(() => client.command(command));
  const requireNavigation = () => {
    if (editorModes.includes(modeRef.current) || ["mcp-token", "schedule"].includes(modeRef.current) || kupoPending.current || queuedContinue.current || queuedArchive.current || planSaving.current || switchingProfile.current || githubPending.current) {
      throw new Error("Save or discard this editor and let the owned operation settle before navigating. Your input is preserved.");
    }
  };
  const navigate = async (tab: TuiTab) => {
    requireNavigation();
    setNavigationFocus(true); setNavigationIndex(tuiTabs.findIndex((entry) => entry.id === tab));
    try {
      await editor?.flush();
      setMode(tab === "session" ? "compose" : tab);
      if (sidebarOnly) setSidebar(false);
    } finally { setNavigationFocus(false); }
  };
  const quitting = useRef(false);
  const quit = async (queued = false) => {
    if (quitting.current) return;
    requireNavigation();
    quitting.current = true;
    try {
      for (const editor of editors.current.values()) await editor.flush();
      if (!queued) await client.commands.detachAll();
      for (const editor of editors.current.values()) editor.dispose();
      client.disconnect();
      if (onQuit) onQuit(); else renderer.destroy();
    } catch (error) { quitting.current = false; throw error; }
  };
  const githubAction = async (action: () => Promise<void>) => {
    if (githubPending.current) return;
    githubPending.current = true; setGithubBusy(true);
    try { await action(); } finally { githubPending.current = false; setGithubBusy(false); }
  };
  const openGithubRepositories = async (source: "account" | "public" = "account", query = "", page = 1, account?: string, accountId?: string) => githubAction(async () => {
    const owner = githubOwner.current, result = await client.github.repositories({ source, query, page, ...(account ? { account } : {}), ...(accountId ? { accountId } : {}) });
    if (githubOwner.current !== owner) return;
    githubSearch.current = { source, query };
    setGithubRepositories(result); setMode("github-repositories");
  });
  const openGithubItems = async (kind: "issue" | "pull", page = 1) => githubAction(async () => {
    if (!session?.projectId || session.controls.env !== "Local") throw new Error("Choose an explicit Local project for GitHub items. No SSH or Sandbox fallback.");
    const owner = githubOwner.current, scope: GithubScope = { env: "Local", projectId: session.projectId, sessionId: session.id, ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) };
    const context = await client.github.project(scope), result = await client.github.browse(scope, { resource: kind === "pull" ? "pulls" : "issues", repository: context.repository, account: context.account, page, perPage: 30 });
    if (context.accountId !== result.accountId) throw new Error("The GitHub account changed. Reload this project's items.");
    if (githubOwner.current !== owner) return;
    setGithubItems({ scope, context, kind, items: result.items, nextPage: result.nextPage }); setMode("github-items");
  });
  const chooseSession = async (id: string) => {
    requireNavigation(); setNavigationFocus(true);
    try {
      await editor?.flush(); setSelectedId(id); setArchiveReview(null); setMode("compose");
      if (snapshot?.sessions.find((session) => session.id === id)?.unread) await client.sessions.organize(id, { unread: false });
      const ids = client.getState().snapshot?.attention.filter((entry) => entry.sessionId === id && !entry.deleted && !entry.acknowledged && entry.reason !== "ci").map((entry) => entry.id) ?? [];
      if (ids.length) await client.attention.acknowledge(ids.slice(-100));
    } finally { setNavigationFocus(false); }
  };
  const openProfiles = async () => { setProfiles((await client.profiles.list()).catalog); setMode("profiles"); };
  const chooseProfile = async (id: string) => {
    if (switchingProfile.current) throw new Error("A profile switch is already in progress.");
    if (editorModes.includes(mode)) throw new Error("Save or discard the local editor before switching profiles.");
    if (snapshot?.jobs.some((job) => job.kind === "voice.record" && job.status === "running")) throw new Error("Stop owned dictation before switching profiles. Audio is not moved.");
    switchingProfile.current = true; setProfilePending(true);
    try {
      for (const editor of editors.current.values()) await editor.flush();
      const next = await client.profiles.open(id);
      for (const editor of editors.current.values()) editor.dispose(); editors.current.clear();
      client.disconnect(); clients.current.delete(client); clients.current.add(next); setClient(next);
      setSelectedId(null); setArchiveReview(null); setMode("compose"); setTokenValue(""); setTokenServer(""); setSettingsText(""); setCapabilityOutput(""); setNotice("");
      artifactEditor.current = null; issueEditor.current = { id: null, revision: 0 }; profileEditor.current = null;
      planEditor.current = null;
    } finally { switchingProfile.current = false; setProfilePending(false); }
  };
  const openProfileEditor = (profile: Profile | null) => { profileEditor.current = profile; setSettingsText(JSON.stringify({ name: profile?.name ?? "", color: profile?.color ?? null }, null, 2)); setMode("profile-editor"); };
  const newSession = async (global = false) => {
    await editor?.flush();
    const result = await client.sessions.create(global ? null : session?.projectId ?? null);
    setSelectedId(result.id!); setMode("compose"); setShowArchived(false);
  };
  const openProject = async (path: string) => {
    await editor?.flush();
    const project = await client.command({ type: "project.add", path });
    const created = await client.command({ type: "session.create", projectId: project.id! });
    setSelectedId(created.id!); setMode("compose"); setShowArchived(false);
  };
  const applyArchiveChoice = async (review: ArchiveReview, action: Extract<SessionChildrenAction, "archive" | "detach">, remember: boolean) => {
    const check = () => {
      const state = client.getState(), current = state.snapshot?.sessions.find((value) => value.id === review.session.id);
      if (state.status !== "connected" || !state.snapshot || !current || current.revision !== review.session.revision ||
        JSON.stringify(sessionChildBindings(state.snapshot.sessions, review.session.id)) !== JSON.stringify(review.expected)) {
        throw new Error("The session or attached children changed after review. Run /archive again; no session was archived.");
      }
    };
    check();
    if (remember) {
      const settings = client.settings.get();
      if (!settings) throw new Error("Child-session preferences are unavailable. No archive was attempted.");
      await client.settings.update({ ...settings.values, retention: { ...settings.values.retention, archiveChildren: action } }, settings.revision);
    }
    check();
    await client.command({ type: "session.archive", sessionId: review.session.id, expectedRevision: review.session.revision,
      ...(review.expected.length ? { children: { action, expected: review.expected } } : {}), ...(review.running.length ? { confirmRunning: true as const } : {}) });
    if (queuedArchive.current?.context.sessionId === review.session.id) queuedArchive.current.settle({ outcome: "completed" });
    setArchiveReview(null); setMode("compose");
  };
  const requestArchive = async (target: Session) => {
    const state = client.getState(), parent = state.snapshot?.sessions.find((value) => value.id === target.id);
    if (!parent || !state.snapshot) throw new Error("The original session is no longer available.");
    const tree = sessionSubtree(state.snapshot.sessions, parent.id), expected = sessionChildBindings(state.snapshot.sessions, parent.id);
    const running = runningSessions(state.snapshot.sessions, state.snapshot.jobs, [parent.id]).map(({ id, title }) => ({ id, title }));
    if (!expected.length && !running.length) {
      await client.command({ type: "session.archive", sessionId: parent.id, expectedRevision: parent.revision });
      return;
    }
    const children = tree.slice(1).map(({ id, title, parentSessionId, kind }) => ({ id, title, parentSessionId, kind }));
    const canDetach = !children.some((child) => child.parentSessionId === parent.id && child.kind === "subagent");
    const preference = state.snapshot.settings.values.retention.archiveChildren ?? "ask";
    if (!running.length && (preference === "archive" || preference === "detach" && canDetach)) {
      await applyArchiveChoice({ session: parent, children, expected, canDetach, running }, preference, false);
      return;
    }
    setArchiveReview({ session: parent, children, expected, canDetach, running });
    setMode("session-action");
  };
  const show = (value: unknown) => { setCapabilityOutput(typeof value === "string" ? value : JSON.stringify(value, null, 2)); setMode("capability-output"); };
  const showReadiness = (result: ModelReadinessResponse) => show(`Read-only execution-machine observations, not inference or a permission grant.\nEnv: ${result.readiness.target.env}\nModel: ${result.readiness.target.modelId}\nRuntime version: ${result.readiness.observations.runtime?.version.value ?? "Unknown / not observed"}\n\n${JSON.stringify(result, null, 2)}`);
  const previewRuntime = (modelId: string) => {
    if (!session || runtimePending.current) return;
    const owner = runtimeOwner.current, abort = new AbortController();
    runtimeAbort.current?.abort(); runtimeAbort.current = abort; runtimePending.current = true; setRuntimeBusy(true);
    void perform(async () => {
      try {
        const { preview } = await client.models.runtimePreview(session.id, modelId, abort.signal);
        if (abort.signal.aborted || runtimeOwner.current !== owner || modeRef.current !== "models") return;
        setRuntimePreview(preview); setRuntimeActionsFocused(false); setMode("runtime-review");
      } finally { runtimePending.current = false; setRuntimeBusy(false); }
    });
  };
  const approveRuntime = () => {
    if (runtimePending.current) return;
    const preview = runtimePreview;
    if (!session || !preview || preview.target.profileId !== client.profileId || preview.target.sessionId !== session.id ||
      preview.target.env !== session.controls.env) { setNotice("The original runtime review owner changed. No another-session or machine approval was sent.", true); return; }
    const owner = runtimeOwner.current, abort = new AbortController();
    runtimeAbort.current?.abort(); runtimeAbort.current = abort; runtimePending.current = true; setRuntimeBusy(true);
    const current = () => !abort.signal.aborted && runtimeOwner.current === owner && modeRef.current === "runtime-review";
    void perform(async () => {
      try {
        const reviewed = await client.models.reviewRuntime(session.id, preview.target.modelId, preview.digest);
        if (!current()) return;
        if (!reviewed.id) throw new Error("The runtime review has no canonical retained receipt. No attempt or automatic retry was sent.");
        const result = await client.models.readinessWithRuntimeReview(session.id, preview.target.modelId, reviewed.id, "informational", abort.signal);
        if (current()) { setRuntimePreview(null); showReadiness(result); }
      } finally { runtimePending.current = false; setRuntimeBusy(false); }
    });
  };
  const openSettingsEditor = (prompt: boolean) => {
    if (!snapshot) { setNotice("Connect before editing settings."); return; }
    settingsRevision.current = snapshot.settings.revision;
    setSettingsText(prompt ? snapshot.settings.values.systemPrompt : JSON.stringify(snapshot.settings.values, null, 2));
    setMode(prompt ? "prompt-editor" : "settings-editor");
  };
  const openIssueEditor = (id?: string) => {
    if (!project || !board) throw new Error("Open a project before editing local issues.");
    const issue = id ? snapshot?.issues.find((issue) => issue.id === id && issue.projectId === project.id) : undefined;
    if (id && !issue) throw new Error("Choose an issue ID from this project's board.");
    issueEditor.current = { id: issue?.id ?? null, revision: issue?.revision ?? 0 };
    setSettingsText(JSON.stringify(issue ? { title: issue.title, body: issue.body, kind: issue.kind, phaseId: issue.phaseId, pullRequestUrl: issue.pullRequest?.url ?? null } :
      { title: "", body: "", kind: "feature", phaseId: board.columns[0]!.id, pullRequestUrl: null }, null, 2));
    setMode("issue-editor");
  };
  const openBoardEditor = () => {
    if (!board) throw new Error("Open a project before configuring a board.");
    const { projectId: _, revision, ...config } = board;
    settingsRevision.current = revision; setSettingsText(JSON.stringify(config, null, 2)); setMode("board-editor");
  };
  const openProjectEditor = async () => {
    if (!project) throw new Error("Open a project before configuring it.");
    const { configuration } = await client.projects.configuration(project.id);
    settingsRevision.current = configuration.revision;
    setSettingsText(JSON.stringify(configuration.values, null, 2)); setMode("project-editor");
  };
  const openArtifactEditor = (request: ArtifactEditorRequest) => {
    artifactEditor.current = request;
    const associations = { folderId: request.folderId ?? null, workItemId: request.workItemId ?? null };
    const candidate = request.id && (snapshot?.decisions.some((record) => record.id === request.id) || snapshot?.candidates.some((candidate) => candidate.id === request.id) || snapshot?.candidateGenerations.some((generation) => generation.id === request.id) || snapshot?.roleSequences.some((sequence) => sequence.id === request.id) || snapshot?.compoundWorkflows.some((workflow) => workflow.id === request.id) || snapshot?.winddowns.some((record) => record.id === request.id) ||
      snapshot?.sandboxExecutions?.some((value) => value.id === request.id) || snapshot?.sandboxPublications?.some((value) => value.id === request.id));
    setSettingsText(JSON.stringify(request.id ? { name: request.name, ...(!candidate ? { text: request.text } : {}), status: request.status, ...associations } : { kind: request.kind, name: request.name, text: request.text, ...associations }, null, 2));
    setMode("artifact-editor");
  };
  const openArtifact = async (id?: string) => {
    if (!id) { openArtifactEditor({ id: null, revision: 0, kind: "research-note", name: "", text: "", status: "active", projectId: session?.projectId ?? null, sessionId: session?.id ?? null }); return; }
    const result = await client.artifacts.read(id);
    openArtifactEditor({ ...result.artifact, text: result.text, sessionId: result.artifact.originSessionId });
  };
  const saveSettings = (text: string) => perform(async () => {
    if (mode === "plan-editor") {
      const target = planEditor.current, value: unknown = JSON.parse(text);
      if (!target || !isRecord(value) || Object.keys(value).some((key) => key !== "text") || typeof value.text !== "string") throw new Error("Edit only the plan's text field. Reopen /plan edit to review a new source binding.");
      if (planSaving.current) throw new Error("The exact plan save is still settling. Its edit is preserved.");
      planSaving.current = true; setPlanPending(true);
      try {
        const saved = await client.plans.save(target.sessionId, value.text, target.digest, target.bindingDigest);
        planEditor.current = null; setMode("compose"); setNotice(`Plan saved and independently retained as ${saved.id}. No model or Local fallback was used.`); return;
      } finally { planSaving.current = false; setPlanPending(false); }
    } else if (mode === "profile-editor") {
      if (switchingProfile.current) throw new Error("A profile operation is already in progress.");
      const values = parse(ProfileDraftSchema, JSON.parse(text)), current = profileEditor.current;
      switchingProfile.current = true; setProfilePending(true);
      try {
        if (current) await client.profiles.update(current.id, values, current.revision);
        else { const created = await client.profiles.create(values.name, values.color); await client.profiles.wait(created.id!); }
        await openProfiles(); setNotice("Profile metadata saved. Choose it explicitly; no accounts, projects or context were copied."); return;
      } finally { switchingProfile.current = false; setProfilePending(false); }
    } else if (mode === "artifact-editor") {
      const request = artifactEditor.current;
      if (!request) throw new Error("Open a retained document first.");
      if (request.id) await client.artifacts.update(request.id, parse(ArtifactChangesSchema, JSON.parse(text)), request.revision);
      else {
        const origin = snapshot?.sessions.some((session) => session.id === request.sessionId && session.projectId === request.projectId) ? request.sessionId : null;
        await client.artifacts.create(origin, { ...parse(ArtifactDraftSchema, JSON.parse(text)), projectId: request.projectId });
      }
      setMode("artifacts"); setNotice("Retained independently. No source file, conversation or policy was changed."); return;
    } else if (mode === "issue-editor") {
      if (!project) throw new Error("The project is no longer open.");
      const fields = parse(IssueInputSchema, JSON.parse(text));
      if (issueEditor.current.id) await client.issues.update(issueEditor.current.id, fields, issueEditor.current.revision);
      else await client.issues.create(project.id, fields);
      setMode("issues"); return;
    } else if (mode === "board-editor") {
      if (!project) throw new Error("The project is no longer open.");
      await client.issues.configure(project.id, parse(BoardConfigSchema, JSON.parse(text)), settingsRevision.current);
      setMode("issues"); return;
    } else if (mode === "project-editor") {
      if (!project) throw new Error("The project is no longer open.");
      await client.projects.configure(project.id, parse(ProjectSettingsSchema, JSON.parse(text)), settingsRevision.current);
    } else if (mode === "prompt-editor") await client.prompt.set(text, settingsRevision.current, true);
    else await client.settings.update(parse(SettingsSchema, JSON.parse(text)), settingsRevision.current, true);
    setMode("settings");
  });
  const voiceJob = snapshot?.jobs.findLast((job) => job.sessionId === session?.id && job.kind === "voice.record" && job.status === "running");
  const latestTranscript = snapshot?.jobs.findLast((job) => job.sessionId === session?.id && ["voice.record", "voice.transcribe"].includes(job.kind) && job.status === "completed");
  const dictate = () => perform(async () => {
    if (!session || !editor) throw new Error("Open a session before dictating.");
    await editor.flush();
    if (voiceJob) return voiceJob.progress.startsWith("Preparing") ? client.jobs.cancel(voiceJob.id) : client.voice.stop(voiceJob.id);
    return client.voice.record(session.id);
  });
  const insertTranscript = () => perform(async () => {
    if (!session || !editor || !latestTranscript) throw new Error("No completed transcript is available for this session.");
    await editor.flush();
    await client.voice.insert(session.id, latestTranscript.id, client.getState().snapshot!.sessions.find((item) => item.id === session.id)!.draft.revision);
  });
  usePaste((event) => {
    if (switchingProfile.current) { event.preventDefault(); return; }
    if (mode !== "mcp-token") return;
    event.preventDefault(); event.stopPropagation();
    const text = new TextDecoder().decode(event.bytes).replace(/[\r\n]/g, "");
    setTokenValue((value) => (value + text).slice(0, 32768));
  });
  const slashResult = async (result: SlashResult) => {
    if (result.kind === "github-view") {
      if (result.view.kind === "repositories") {
        setGithubRepositories(result.view.result); githubSearch.current = { source: result.view.result.source, query: result.view.query }; setMode("github-repositories");
      } else {
        setGithubItems({ scope: result.view.scope, context: result.view.context, kind: result.view.resource, items: result.view.items, nextPage: result.view.nextPage }); setMode("github-items");
      }
      return;
    }
    if (result.kind === "client-view") {
      switch (result.name) {
        case "my-work": setMyWorkFilters(parse(MyWorkFiltersSchema, JSON.parse(result.argument))); setMode("my-work"); return;
        case "help": setSkillHelp({ profileId: client.profileId, text: result.text ?? "" }); setMode("help"); return;
        case "commands": setMode("command-results"); return;
        case "issues": setMode("issues"); return;
        case "issue": {
          const [action, id] = result.argument.split(/\s+/);
          if (action !== "new" && action !== "edit") throw new Error("This issue action does not own an editor.");
          openIssueEditor(action === "edit" ? id : undefined); return;
        }
        case "board": openBoardEditor(); return;
        case "settings": openSettingsEditor(false); return;
        case "project-settings": await openProjectEditor(); return;
        case "prompt": openSettingsEditor(true); return;
        case "trace": setMode("trace"); return;
        case "details": toggleDetails(); return;
        case "archive":
          if (!session) throw new Error("The original archive owner was removed.");
          await requestArchive(session); return;
        case "reload-draft": case "keep-draft":
          if (!editor || editor.getState().text || editor.getState().dirty) throw new Error("Newer composer input exists. Resolve its draft explicitly; the original queued command cannot overwrite it.");
          if (result.name === "reload-draft") editor.reload(); else await editor.keepMine();
          return;
        case "api-key": case "login-code":
          setTokenKind(result.name === "api-key" ? "hosted-key" : "hosted-code"); setTokenServer(result.argument); setTokenValue(""); setMode("mcp-token"); return;
        case "cache": case "linear": case "mcp": case "model-token": case "remote-model-token": {
          const server = result.name === "cache" ? result.argument.slice(6) : result.name === "mcp" ? result.argument.split(/\s+/)[1] ?? "" : result.name === "linear" ? "" : result.argument;
          if (result.name === "cache" && !snapshot?.dependencyRegistries.some((registry) => registry.id === server)) throw new Error("Choose an exact registry ID from /cache registries.");
          setTokenKind(result.name === "cache" ? "cache" : result.name === "linear" ? "linear" : result.name === "model-token" ? "model" : result.name === "remote-model-token" ? "remote-model" : "mcp");
          setTokenServer(server); setTokenValue(""); setMode("mcp-token"); return;
        }
      }
      if (result.name === "sidebar") {
        if (result.argument && !["open", "close"].includes(result.argument)) throw new Error("Use /sidebar [open|close].");
        setSidebar(result.argument === "open" ? true : result.argument === "close" ? false : !sidebarVisible);
        setNavigationFocus(true); setNavigationIndex(Math.max(0, tuiTabs.findIndex((tab) => tab.id === activeTab))); return;
      }
      if (result.argument) throw new Error("This queued navigation action takes no arguments.");
      if (result.name === "quit") { await quit(true); return; }
      const tab = tuiTabs.find((tab) => tab.id === result.name);
      if (!tab) throw new Error(`This terminal has no handler for ${result.name}. No queued view was acknowledged.`);
      await navigate(tab.id); return;
    }
    if (result.kind === "continue-work") { setContinueReview(result.review); setMode("continue-work"); return; }
    if (result.kind === "profiles") { await openProfiles(); return; }
    if (result.kind === "profile") { await chooseProfile(result.profileId); return; }
    if (result.kind === "ok") { setNotice(result.message); return; }
    if (result.kind === "text") { show(result.text); return; }
    if (result.kind === "session") { await chooseSession(result.sessionId); if (client.getState().snapshot?.sessions.find((session) => session.id === result.sessionId)?.purpose === "kanban") setMode("issues"); return; }
    if (result.kind === "copy") { if (!native) throw new Error("Clipboard access is unavailable in this terminal binding."); await native.copy(result.text); setNotice("Copied."); return; }
    if (result.kind === "artifact-editor") { openArtifactEditor(result.artifact); return; }
    if (result.kind === "export") { if (!native?.saveExport || !result.path) throw new Error("Use /artifact export ID ABSOLUTE_NEW_FILE_PATH with an available native file binding."); const saved = await native.saveExport(result.path, result.document); setNotice(`Export saved to ${saved.path}. Stored copies are unchanged.`); return; }
    if (result.panel === "Plan" && result.planEditor) { planEditor.current = result.planEditor; setSettingsText(JSON.stringify({ text: result.planEditor.text }, null, 2)); setMode("plan-editor"); }
    else if (result.panel === "Models") setMode("models");
    else if (result.panel === "Settings") setMode("settings");
    else if (result.panel === "Queue") setMode("queue");
    else if (result.panel === "Artifacts") setMode("artifacts");
    else if (result.panel === "Work item") setMode("work-items");
    else if (result.panel === "Insights") show({ session, project, routings: session ? client.routing.history(session.id) : [], events: events.filter((event) => event.session_id === session?.id).slice(-20) });
    else if (result.url) { if (!native) throw new Error("Default-browser access is unavailable in this terminal binding."); await native.browser(result.url); }
    else if (result.path) { if (!native) throw new Error("Default-file access is unavailable in this terminal binding."); await native.file(result.path); }
    else if (result.text) show(result.text);
    else throw new Error("This panel is available only in the desktop app.");
  };
  const submit = async (text: string, held = false) => {
    if (text.trim() === "exit" || text.trim() === "/exit") {
      if (held) throw new Error("Exit is a local TUI action. Use Enter or Ctrl+C; held input was not executed or sent.");
      requireNavigation();
      await quit(); return;
    }
    const firstSpace = text.indexOf(" ");
    const name = (firstSpace < 0 ? text : text.slice(0, firstSpace)).trim();
    const argument = firstSpace < 0 ? "" : text.slice(firstSpace + 1).trim();
    if (name === "/otlp") {
      if (held) throw new Error("OTLP settings require an explicit unheld user review. Held input was not executed or exported.");
      requireNavigation();
      const credential = argument.match(/^credential set (\S+) (\S+)$/);
      if (credential) { setTokenKind("otlp-header"); setTokenServer(JSON.stringify([credential[1], credential[2]])); setTokenValue(""); setMode("mcp-token"); return; }
      show(await executeOtlpCommand(client, argument));
      if (!session) setStartupCommand("");
      return;
    }
    if (name === "/stainless") {
      if (held) throw new Error("Stainless actions need an explicit unheld command. Held input was not executed or opened.");
      requireNavigation();
      const result = await executeStainlessCommand(client, argument, session?.id, session?.browserUrl);
      show("summary" in result ? result.summary : `Opened ${result.opened} in Stainless.`);
      if (!session) setStartupCommand("");
      return;
    }
    if (name === "/automations") {
      if (held) throw new Error("Automation actions need an explicit unheld command. Held input was not executed.");
      requireNavigation();
      show(await executeAutomationsCommand(client, argument));
      if (!session) setStartupCommand("");
      return;
    }
    if (!session || !editor) {
      if (name === "/new" && (!argument || argument === "global")) await newSession(true);
      else if (name === "/open" && argument) await openProject(argument);
      else if (name === "/connect" && !argument) await client.command({ type: "provider.login" });
      else if (name === "/connect" && (argument === "chatgpt" || argument === "openrouter")) await client.models.hosted.login(argument);
      else if (name === "/profiles" && !argument) await openProfiles();
      else if (name === "/settings" && !argument) setMode("settings");
      else if (name === "/theme" && !argument) setMode("themes");
      else if (name === "/help" && !argument) setMode("help");
      else if (name === "/sessions" && !argument) setMode("sessions");
      else if (name === "/quit" && !argument) await quit();
      else throw new Error("No current chat. Use /new global, /open ABSOLUTE_PATH, /connect, /profiles, /theme, /settings or /help. Nothing was sent.");
      setStartupCommand(""); return;
    }
    const shell = parseShellCommand(text);
    if (shell !== null) {
      // The user's own console input: no prompt, steer, queue item or model call.
      if (held) throw new Error("! runs a command in this chat's terminal right away; it cannot be held or scheduled. Nothing was run.");
      const ran = await client.terminal.run(session.id, shell);
      if (editor.getState().text === text) { editor.edit(""); await editor.flush(); }
      setNotice(`Ran in this chat's terminal${ran.root ? ` at ${ran.root}` : ""}. /terminals read ${ran.terminalId} shows its output; interactive prompts need the desktop Terminal.`);
      return;
    }
    if (!text.startsWith("/")) {
      if (!held && retry) {
        if (retryPending.current) return;
        retryPending.current = true;
        try { await client.sessions.retry(session.id, retry.id, retry.revision); }
        finally { retryPending.current = false; }
        return;
      }
      if (held && !session.turnId) {
        const choice = snapshot?.settings.values.interactions.idleScheduleAction ?? "ask";
        if (choice === "send") { await submit(text, false); return; }
        setScheduleInitial(choice); setMode("schedule"); return;
      }
      if (pendingQuestion && !held && !text.startsWith("/")) { await editor.flush(); await client.questions.answerDraft(pendingQuestion.id, pendingQuestion.revision, otherQuestion === pendingQuestion.id); return; }
      if (!held && session.projectId && !text.startsWith("/") && continueWorkInput(text)) {
        setContinueReview(await editor.reviewContinueWork()); setMode("continue-work"); return;
      }
      await editor.send(held ? "queue" : "auto", held);
      return;
    }
    if (session.status === "archived" && name === "/restore" && !argument) {
      await client.commands.restore(session.id, "tui", session.revision, held);
      if (editor.getState().text === text) editor.reload();
      return;
    }
    if (editor.getState().text !== text || editor.getState().conflict) throw new Error("The original command draft changed. Its newer text was preserved.");
    const navigation = navigationEpoch.current, result = await editor.submit((expectedDraftRevision) => client.commands.submit(session.id, { client: "tui", expectedDraftRevision, delivery: "queue", held }));
    if (result.id) { submittedViews.current.set(result.id, navigation); setResponsePulse((value) => value + 1); }
  };
  const commandAttachment = useRef<CommandClientAttachment | null>(null);
  const commandUi = useRef<{ canApply(execution: CommandExecution): boolean; apply(context: CommandViewContext): Promise<CommandViewOutcome> } | null>(null);
  commandUi.current = {
    canApply: (execution) => execution.sessionId === selectedId && execution.profileId === client.profileId && !editorModes.includes(modeRef.current) &&
      !["mcp-token", "continue-work", "session-action", "schedule"].includes(modeRef.current) && !planSaving.current && !switchingProfile.current && !githubPending.current && !profilePending,
    apply: async (context) => {
      context.signal.throwIfAborted(); requireNavigation();
      if (context.sdk !== client || context.sessionId !== selectedId) throw new Error("The original terminal conversation/profile changed before applying its queued view.");
      const result = context.result;
      if (result.kind === "client-view" && result.name === "archive") {
        return new Promise<CommandViewOutcome>((resolve, reject) => {
          const clear = () => {
            if (queuedArchive.current?.context.execution.id === context.execution.id) { queuedArchive.current = null; setArchiveReview(null); setArchivePending(false); setMode("compose"); }
          };
          const abort = () => { clear(); reject(context.signal.reason ?? new Error("The original queued archive owner ended.")); };
          const settle = (outcome: CommandViewOutcome) => { context.signal.removeEventListener("abort", abort); clear(); resolve(outcome); };
          queuedArchive.current = { context, pending: false, settle };
          context.signal.addEventListener("abort", abort, { once: true });
          const target = client.getState().snapshot?.sessions.find((session) => session.id === context.sessionId);
          if (!target || context.signal.aborted) { abort(); return; }
          void requestArchive(target).then(() => {
            if (client.getState().snapshot?.sessions.find((session) => session.id === context.sessionId)?.status === "archived") settle({ outcome: "completed" });
          }).catch((error: unknown) => { context.signal.removeEventListener("abort", abort); clear(); reject(error); });
        });
      }
      if (result.kind === "continue-work") {
        if (!("command" in result.review)) throw new Error("The original queued continuation review is missing; a saved composer was not substituted.");
        return new Promise<CommandViewOutcome>((resolve, reject) => {
          const clear = () => {
            if (queuedContinue.current?.context.execution.id === context.execution.id) { queuedContinue.current = null; setContinueReview(null); setContinuePending(false); setMode("compose"); }
          };
          const abort = () => { clear(); reject(context.signal.reason ?? new Error("The exact queued continuation owner ended.")); };
          const settle = (outcome: CommandViewOutcome) => {
            context.signal.removeEventListener("abort", abort);
            const owned = queuedContinue.current;
            if (outcome.outcome === "cancelled" && outcome.restoreInput && owned?.context.execution.id === context.execution.id) {
              owned.cancelling = true; owned.pending = true; setContinuePending(true);
            } else clear();
            resolve(outcome);
          };
          queuedContinue.current = { context, pending: false, settle };
          context.signal.addEventListener("abort", abort, { once: true });
          setContinueReview(result.review); setContinuePending(false); setMode("continue-work");
          if (context.signal.aborted) abort();
        });
      }
      const expectedSidebar = result.kind === "client-view" && result.name === "sidebar" ?
        result.argument === "open" || result.argument !== "close" && !sidebarVisible : null;
      await slashResult(result);
      context.signal.throwIfAborted();
      if (result.kind === "copy" || result.kind === "export" || result.kind === "client-view" && result.name === "quit") return { outcome: "completed" };
      const expectedProfile = result.kind === "profile" ? result.profileId : client.profileId;
      const expectedSession = result.kind === "session" ? result.sessionId : context.sessionId, expectedMode = modeRef.current;
      await waitForCommandFrame(renderer, context.signal, () => {
        if (!renderer.root.findDescendantById(`tui-profile-${expectedProfile}`)) return false;
        if (result.kind === "profile") return true;
        if (expectedSidebar !== null) return renderer.root.findDescendantById("tui-sidebar")?.visible === expectedSidebar;
        if (result.kind === "client-view" && result.name === "my-work" && !renderer.root.findDescendantById(`tui-my-work-${client.profileId}`)?.visible) return false;
        return renderer.root.findDescendantById(`tui-surface-${expectedSession}-${expectedMode}`)?.visible === true;
      });
      return { outcome: "completed" };
    },
  };
  useEffect(() => {
    if (status !== "connected") return;
    let closed = false, attached: CommandClientAttachment | undefined;
    const apply = (context: CommandViewContext) => {
      if (!commandUi.current) throw new Error("The original terminal view owner is closed.");
      return commandUi.current.apply(context);
    };
    const views = ["session", "sessions", "work-items", "code-requests", "sidebar", "quit", "issues", "issue", "board", "settings",
      "project-settings", "prompt", "trace", "details", "reload-draft", "keep-draft", "cache", "linear", "mcp", "model-token", "remote-model-token", "help", "archive", "commands", "my-work"];
    const handlers = Object.fromEntries(views.map((name) => [`client-view:${name}`, apply]));
    void client.commands.attach("tui", { ...handlers, panel: apply, session: apply, profile: apply, profiles: apply, copy: apply, export: apply, "artifact-editor": apply, "continue-work": apply, "github-view": apply },
      { canApply: (execution) => !closed && (commandUi.current?.canApply(execution) ?? false), onError: (error) => {
        if (!closed) { settleContinuationCancellation(); setNotice(error.message, true); }
      } })
      .then((value) => { attached = value; if (closed) return value.dispose(); commandAttachment.current = value; })
      .catch((error: unknown) => { if (!closed) setNotice(error instanceof Error ? error.message : "The actual terminal command client could not attach.", true); });
    return () => {
      closed = true; if (commandAttachment.current === attached) commandAttachment.current = null;
      if (attached) void attached.dispose().catch((error: unknown) => console.error("Terminal command detach remains unconfirmed:", error instanceof Error ? error.message : "original client cleanup failed"));
    };
  }, [client, status]);
  useEffect(() => { commandAttachment.current?.wake(); }, [selectedId, mode, profilePending, githubBusy, planPending]);
  const displayedCommands = useRef(new Set<string>());
  const [commandResponses, setCommandResponses] = useState<{ id: string; name: string; text: string }[]>([]);
  const commandResponseOwner = useRef<{ client: MoguriSdk; sessionId: string | null } | null>(null);
  commandResponseOwner.current = { client, sessionId: selectedId };
  useEffect(() => () => { commandResponseOwner.current = null; }, []);
  useEffect(() => {
    displayedCommands.current = new Set(client.getState().snapshot?.commandExecutions.map((entry) => entry.id) ?? []);
    submittedViews.current.clear();
    setCommandResponses([]);
  }, [client]);
  useEffect(() => {
    const owns = () => commandResponseOwner.current?.client === client && commandResponseOwner.current.sessionId === selectedId;
    for (const entry of snapshot?.commandExecutions ?? []) {
      if (entry.client !== "tui" || entry.sessionId !== selectedId || !["completed", "failed", "partial", "cancelled"].includes(entry.status) || displayedCommands.current.has(entry.id)) continue;
      const navigation = submittedViews.current.get(entry.queueItemId);
      if (navigation === undefined) continue;
      displayedCommands.current.add(entry.id);
      void client.commands.read(entry.id).then(({ result, item }) => {
        if (!owns()) return;
        if (result?.kind === "ok") setNotice(result.message);
        if (entry.status !== "completed" && entry.diagnostic) setNotice(entry.diagnostic, true);
        const text = result?.kind === "text" ? result.text : entry.diagnostic;
        if (text) setCommandResponses((values) => [...values, { id: entry.id, name: entry.name, text }].slice(-10));
        if (result?.kind === "text" && navigationEpoch.current === navigation && !navigationFocusRef.current && modeRef.current === "compose" && !editor?.getState().text && !editor?.getState().dirty) {
          if (item.command?.name === "issue" && item.command.argument.startsWith("create ")) setMode("issues");
          else show(result.text);
        }
        submittedViews.current.delete(entry.queueItemId);
      }).catch((error: unknown) => { if (owns()) setNotice(error instanceof Error ? error.message : "The original retained command result could not be read.", true); });
    }
  }, [client, selectedId, snapshot?.commandExecutions, responsePulse]);
  useKeyboard((key) => {
    if (key.defaultPrevented) return;
    if (quitting.current) { key.preventDefault(); key.stopPropagation(); return; }
    if (["return", "kpenter"].includes(key.name) && modeRef.current !== mode) { key.preventDefault(); key.stopPropagation(); return; }
    if (switchingProfile.current) { key.preventDefault(); key.stopPropagation(); return; }
    if (kupoPending.current) { key.preventDefault(); key.stopPropagation(); setNotice("The original Kupo mode selection is still awaiting acknowledgement. Your draft is preserved."); return; }
    if (mode === "schedule") {
      if (key.ctrl && key.name === "c") {
        key.preventDefault(); key.stopPropagation(); setNotice("Save or cancel this scheduled input before leaving the TUI. Your draft is preserved."); return;
      }
      if (key.name === "escape") {
        key.preventDefault(); key.stopPropagation();
        if (schedulePending.current) setNotice("The original scheduled input is still awaiting acknowledgement. No replacement was sent.");
        else setMode("compose");
      }
      return;
    }
    if (mode === "plan-editor" && planSaving.current) {
      if (key.name === "escape" || key.ctrl && ["q", "c"].includes(key.name)) {
        key.preventDefault(); key.stopPropagation();
        if (key.ctrl && key.name === "c" && planEditor.current) {
          const target = planEditor.current, save = client.getState().snapshot?.planSaves.findLast((save) => save.sessionId === target.sessionId && save.status === "running");
          if (save) void perform(() => client.plans.stopSave(target.sessionId, save.id));
          else setNotice("No exact stoppable save is published yet. Inspect /plan saves; no other turn was stopped.");
        } else setNotice("The exact plan save is still settling. Ctrl+C requests its owned stop; your editor is preserved.");
      }
      return;
    }
    if (mode === "mcp-token") {
      key.preventDefault(); key.stopPropagation();
      if (key.name === "escape" || key.ctrl && key.name === "c") { setTokenValue(""); setMode("settings"); return; }
      if (key.name === "backspace") setTokenValue((value) => value.slice(0, -1));
      else if (key.name === "return" && tokenValue) void perform(async () => { if (tokenKind === "linear") await client.linear.setToken(tokenValue); else if (tokenKind === "cache") await client.cache.registries.setToken(tokenServer, tokenValue); else if (tokenKind === "model") await client.models.setToken(tokenServer, tokenValue); else if (tokenKind === "hosted-key") await client.models.hosted.setKey(tokenServer as "openrouter", tokenValue); else if (tokenKind === "hosted-code") await client.models.hosted.submitCode(tokenServer as "chatgpt", tokenValue); else if (tokenKind === "remote-model") await client.remote.setToken(tokenServer, tokenValue); else if (tokenKind === "otlp-header") { const [endpoint, name] = JSON.parse(tokenServer) as [string, string]; await client.telemetry.export.setCredential(endpoint, name, tokenValue); } else await client.mcp.setToken(tokenServer, tokenValue, session?.id); setTokenValue(""); setMode("settings"); });
      else if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " ") setTokenValue((value) => (value + key.sequence).slice(0, 32768));
      return;
    }
    if (mode === "runtime-review" && (key.name === "escape" || key.ctrl && key.name === "c")) {
      key.preventDefault(); key.stopPropagation(); runtimeAbort.current?.abort(); setRuntimePreview(null); setMode("models"); return;
    }
    if (mode === "runtime-review" && key.name === "tab") {
      key.preventDefault(); key.stopPropagation(); setRuntimeActionsFocused((value) => !value); return;
    }
    if (navigationFocusRef.current && (!key.ctrl && !key.meta && !key.super || ["return", "kpenter"].includes(key.name))) {
      if (["left", "right", "up", "down", "return", "kpenter", "tab", "escape"].includes(key.name)) {
        key.preventDefault(); key.stopPropagation();
        if (key.ctrl || key.meta || key.super) return;
        if (key.name === "left" || key.name === "right") setSidebar(key.name === "right");
        else if (key.name === "up" || key.name === "down") setNavigationIndex((navigationIndexRef.current + (key.name === "up" ? -1 : 1) + tuiTabs.length) % tuiTabs.length);
        else if (key.name === "return" || key.name === "kpenter") void perform(() => navigate(tuiTabs[navigationIndexRef.current]!.id));
        else { setNavigationFocus(false); if (sidebarOnly) setSidebar(false); if (key.name === "escape") setMode("compose"); }
      }
      return;
    }
    if (key.ctrl && key.name === "c" && (queuedContinue.current?.pending || queuedArchive.current?.pending)) {
      key.preventDefault(); key.stopPropagation();
      if (session) void command({ type: "session.stop", sessionId: session.id });
      else setNotice("The original command is still settling; no other session was stopped.");
      return;
    }
    if (key.name === "escape") {
      if (queuedContinue.current?.pending) { setNotice("The original choice is still settling. Ctrl+C requests its owned stop; no replacement route will be sent."); return; }
      if (queuedArchive.current?.pending) { setNotice("The original archive is still settling. Ctrl+C stops owned work; it cannot promise to undo an admitted archive."); return; }
      if (queuedContinue.current) {
        queuedContinue.current.settle({ outcome: "cancelled", restoreInput: true, diagnostic: "The actual user cancelled this original continuation before choosing a route." });
        return;
      }
      queuedArchive.current?.settle({ outcome: "cancelled", diagnostic: "The actual user cancelled this exact archive review. No archive was requested." });
      setContinueReview(null); setArchiveReview(null); setMode("compose"); if (sidebarOnly) setSidebar(false); return;
    }
    if (mode === "github-clone" && githubCloneJob && key.ctrl && key.name === "c") { key.preventDefault(); void perform(() => client.jobs.cancel(githubCloneJob)); return; }
    if (mode === "github-detail" && githubSelection && key.ctrl && ["n", "l", "b"].includes(key.name)) {
      key.preventDefault();
      void perform(() => githubAction(async () => {
        if (key.name === "n") { const created = await client.github.startSession(githubSelection.scope, githubSelection.source, githubSelection.digest); await chooseSession(created.id!); }
        else if (key.name === "l") {
          if (!session) throw new Error("The destination session was removed.");
          await client.sessions.organize(session.id, githubSelection.source.kind === "pull" ? { prUrl: githubSelection.item.url } : { workItemUrl: githubSelection.item.url });
          setNotice("Linked the exact item. No checkout or inference was started.");
        } else { if (!native || !githubSelection.item.url) throw new Error("No native browser binding or canonical item URL is available."); await native.browser(githubSelection.item.url); }
      })); return;
    }
    if (mode === "compose" && key.name === "tab" && editor) {
      const trigger = parseAttachmentTrigger(editor.getState().text);
      if (trigger) {
        key.preventDefault(); key.stopPropagation();
        show({ selectedType: attachmentTriggers[trigger.prefix], query: trigger.query, guidance: "Choose explicit /attach-file, /attach-image, /attach-folder, /attach-github, /attach-session or /attach for project files. Preview/confirm source snapshots before sending. Terminal clipboard images use a path fallback. The current prefix text has not attached or executed anything." });
        return;
      }
      if (tuiCommandSuggestions(editor.getState().text).length) return;
    }
    if (key.ctrl && ["q", "c"].includes(key.name) && editorModes.includes(mode)) { key.preventDefault(); setNotice("Save with Ctrl+Enter or cancel with Esc before leaving this editor."); return; }
    if (editorModes.includes(mode)) {
      if (key.ctrl && key.name === "r" && ["prompt-editor", "settings-editor"].includes(mode)) { key.preventDefault(); void perform(async () => { await client.settings.reset(mode === "prompt-editor" ? "systemPrompt" : "all", settingsRevision.current); setMode("settings"); }); }
      return;
    }
    if (key.name === "tab" && !key.ctrl && !key.meta && !key.super) {
      key.preventDefault(); key.stopPropagation(); setNavigationFocus(true);
      setNavigationIndex(Math.max(0, tuiTabs.findIndex((tab) => tab.id === activeTab))); return;
    }
    if (mode === "compose" && key.name === "f2") {
      key.preventDefault(); key.stopPropagation(); toggleDetails();
      return;
    }
    if (mode === "compose" && key.name === "f3") { key.preventDefault(); key.stopPropagation(); followLatest(); return; }
    if (mode === "compose" && !key.ctrl && !key.meta && !key.super && !key.shift && ["pageup", "pagedown"].includes(key.name) && transcript.current) {
      key.preventDefault(); key.stopPropagation(); setFollowTranscript(false);
      transcript.current.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, transcript.current.viewport.height - 2));
      return;
    }
    if (key.name === "f5") { key.preventDefault(); setMode("artifacts"); return; }
    if (key.name === "f7") {
      key.preventDefault(); void perform(async () => {
        const [overview, budget, profiles, operations, storage, analytics] = await Promise.all([client.dashboard.overview(), client.budgets.dashboard(), client.profiles.list(), client.telemetry.operations({ limit: 10 }), client.telemetry.storage(), client.analytics.overview()]);
        show({ ...overview, budget, globalBudget: profiles.catalog.globalBudget, operations, storage: storage.storage, liveAnalytics: analytics });
      }); return;
    }
    if (key.name === "f8") { key.preventDefault(); void perform(openProfiles); return; }
    if (key.name === "f9") { key.preventDefault(); void perform(() => navigate("automations")); return; }
    if (mode === "compose" && key.name === "f10" && retry && session) {
      key.preventDefault(); void perform(() => submit(editor?.getState().text ?? "")); return;
    }
    if (mode === "compose" && key.name === "f11" && session?.controls.modelId === "kupo") {
      key.preventDefault(); setMode("kupo-mode"); return;
    }
    if (mode === "compose" && key.name === "f12" && repositoryPrompt) { key.preventDefault(); setMode("repository-import"); return; }
    if (key.name === "f6") { key.preventDefault(); if (pendingQuestion) setMode("question"); else setNotice("No actual pending question is owned by this turn."); return; }
    if (mode === "compose" && ["return", "kpenter"].includes(key.name) && (key.ctrl || key.meta || key.super)) {
      key.preventDefault(); key.stopPropagation();
      if (editor) void perform(() => submit(editor.getState().text, !key.shift));
      return;
    }
    if (key.name === "f4") { key.preventDefault(); void insertTranscript(); return; }
    if (!key.ctrl) return;
    if (["q", "c", "o", "n", "l", "m", "p", "k", "b", "y", "d", "a", "r", "s", "v", "g", "space"].includes(key.name)) key.preventDefault();
    if (key.name === "g") { setMode("settings"); return; }
    if (key.name === "space") { void dictate(); return; }
    if (key.name === "q" || key.name === "c") void perform(quit);
    else if (key.name === "o") setMode("project");
    else if (key.name === "n") void perform(newSession);
    else if (key.name === "l") void command({ type: "provider.login" });
    else if (key.name === "m") setMode("models");
    else if (key.name === "p") setMode("sessions");
    else if (key.name === "k") setMode("help");
    else if (key.name === "b") setMode("trace");
    else if (key.name === "a") { setShowArchived((value) => !value); setMode("sessions"); }
    else if (key.name === "r") editor?.reload();
    else if (key.name === "s" && editor) void perform(() => editor.getState().conflict ? editor.keepMine() : editor.flush());
    else if (key.name === "v" && session?.pendingApproval) setMode("approval");
    else if (key.name === "y" && key.shift && session?.pendingApproval) setMode("approval-choices");
    else if ((key.name === "y" || key.name === "d") && session?.pendingApproval) void command({
      type: "approval.respond", sessionId: session.id, approvalId: session.pendingApproval.id, allow: key.name === "y",
    });
  });
  const options = snapshot?.sessions.filter((item) => (item.status === "archived") === showArchived).sort((a, b) =>
    (a.projectId ?? "").localeCompare(b.projectId ?? "") || compareSessionPriority(a, b, snapshot)).map((item) => {
    const attention = snapshot.settings.values.notifications.inApp ? snapshot.attention.findLast((entry) => entry.sessionId === item.id && entry.active) : undefined;
    const prefix = attention ? attention.kind === "question" ? "? " : attention.kind === "done" ? "o " : "! " : "";
    const scope = snapshot.projects.find((project) => project.id === item.projectId)?.name ??
      (item.repositories ? `${item.repositories.length} repositories` : item.controls.env === "Local" && item.homeRoot ? "Home" : "No project");
    const state = sessionStatusLabel(item.status);
    return { name: `${item.pinned ? "* " : ""}${prefix}${safe(label(item))}`, state, scope,
      description: `${scope} / ${state.label} / ID ${item.id}`, value: item.id };
  }) ?? [];
  const inlineControls = width - (sidebarVisible && !sidebarOnly ? 26 : 0) >= 90;
  const sessionStateVisible = session && (session.mode !== "agent" || session.pendingMode || session.queue.length > 0 || !["idle", "completed"].includes(session.status));
  const planVisible = session && !compactDecision && (taskProgress.error || (taskProgress.progress?.checklist.total ?? 0) > 0);
  const estimateVisible = !compactDecision && taskProgress.progress?.longRunning && taskProgress.progress.model;
  const settledToolCalls = new Set(session?.messages.filter((message) => message.role === "tool").flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []));
  return <ThemeContext.Provider value={colors}><NavigationContext.Provider value={navigationFocus}><box id={`tui-profile-${client.profileId}`} width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
    <box id="tui-header" height={1} flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row">
      <box id="tui-sidebar-toggle" width={10} height={1} onMouseDown={(event) => {
        if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
        void perform(async () => { requireNavigation(); setSidebar(!sidebarVisible); setNavigationFocus(true); });
      }}><text fg={colors.accent}>{sidebarVisible ? "[-] Menu" : "[+] Menu"}</text></box>
      <text height={1} wrapMode="none" truncate fg={colors.accent}><strong>{"<> moguri"}</strong></text><text height={1} flexGrow={1} wrapMode="none" truncate fg={colors.muted}>  {safe(snapshot?.profile?.name ?? client.profileId)}{width >= 80 ? ` / ${safe(project?.name ?? (session?.repositories ? `${session.repositories.length} repositories` : session?.controls.env === "Local" && session.homeRoot ? "Home (no project)" : session ? "No project" : "Workspace"))}` : ""}{session && width >= 110 ? ` / ${safe(label(session))} (${sessionShortId(session.id)})` : ""}</text>
      <text height={1} wrapMode="none" fg={status === "connected" ? colors.accent : colors.attention}>{profilePending ? "Updating profile..." : status}</text>
    </box>
    <box id="tui-navigation" height={width < 40 ? 2 : 1} flexShrink={0} flexDirection="row" flexWrap="wrap">
      {tuiTabs.map((tab, index) => <box id={`tui-tab-${tab.id}`} key={tab.id} width={width < 40 ? "33.333%" : "20%"} height={1} paddingLeft={1}
        backgroundColor={activeTab === tab.id || navigationFocus && navigationIndex === index ? colors.panel : colors.background}
        onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); void perform(() => navigate(tab.id)); }}>
        <text height={1} wrapMode="none" truncate fg={activeTab === tab.id || navigationFocus && navigationIndex === index ? colors.selection : colors.muted}>
          {navigationFocus && navigationIndex === index ? "> " : activeTab === tab.id ? "* " : "  "}{width < 110 ? tab.compact : tab.label}
        </text>
      </box>)}
    </box>
    <box flexGrow={1} minHeight={0} flexDirection="row">
      <box id="tui-sidebar" visible={sidebarVisible} width={sidebarOnly ? "100%" : 26} border={["right"]} borderColor={navigationFocus ? colors.accent : colors.border} backgroundColor={colors.sidebar} paddingX={1} flexDirection="column">
        <text height={1} fg={colors.muted}>{showArchived ? "Archived chats" : "Chats"}</text>
        <scrollbox flexGrow={1} minHeight={0}>{options.map((option) => <box key={option.value} flexDirection="column" height={2} flexShrink={0}
          backgroundColor={option.value === selectedId ? colors.panel : colors.sidebar}
          onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); void perform(async () => { await chooseSession(option.value); setNavigationFocus(false); if (sidebarOnly) setSidebar(false); }); }}>
          <text height={1} wrapMode="none" truncate fg={option.value === selectedId ? colors.selection : colors.foreground}>{option.value === selectedId ? "> " : "  "}{option.name}</text>
          <box height={1} flexDirection="row"><text height={1} flexShrink={0} wrapMode="none" fg={option.value === selectedId ? colors.selection :
            option.state.tone === "failed" ? colors.error : ["attention", "partial", "unknown"].includes(option.state.tone) ? colors.attention : colors.muted}>{option.state.label}</text>
            <text height={1} flexGrow={1} wrapMode="none" truncate fg={option.value === selectedId ? colors.selection : colors.muted}>{safe(` / ${option.scope}`)}</text></box>
        </box>)}{!options.length && <text fg={colors.muted}>{"No sessions yet.\n/new global\n/open PATH\n/connect"}</text>}</scrollbox>
        <text fg={colors.muted} height={2}>{"/new  /sessions\n/profiles  /sidebar"}</text>
      </box>
      <box id={`tui-surface-${selectedId ?? "none"}-${mode}`} visible={!sidebarOnly} flexGrow={1} minWidth={0} minHeight={0} overflow="hidden" flexDirection="column" paddingX={compact ? 1 : 2} backgroundColor={colors.background}>
        {mode === "profiles" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Profiles / {safe(snapshot?.profile?.name ?? client.profileId)}</text>
          <text fg={colors.muted} height={3}>Accounts, projects, drafts and memory stay separate. Switching does not stop owned work. New profiles copy no private data or model selection.</text>
          <ThemedSelect focused={!profilePending} flexGrow={1} options={[
            { name: "+ Create isolated profile", description: "Edit display name and optional #RRGGBB accent.", value: "create" },
            { name: "Rename / color current profile", description: "Immutable identity and credentials are preserved.", value: "edit" },
            ...(profiles?.profiles ?? []).map((profile) => ({ name: `${profile.id === client.profileId ? "* " : ""}${safe(profile.name)}`, description: `${profile.status} / ${profile.id}${profile.diagnostic ? ` / ${safe(profile.diagnostic)}` : ""}`, value: `profile:${profile.id}` })),
          ]} onSelect={(_, option) => { if (!option || switchingProfile.current) return; void perform(async () => {
            if (option.value === "create") { openProfileEditor(null); return; }
            const profile = profiles?.profiles.find((profile) => profile.id === (option.value === "edit" ? client.profileId : String(option.value).slice(8)));
            if (!profile) throw new Error("Refresh the actual profile catalog with F8.");
            if (option.value === "edit") { openProfileEditor(profile); return; }
            if (profile.status !== "ready") {
              profileEditor.current = profile; setMode("profile-recovery"); return;
            }
            await chooseProfile(profile.id);
          }); }} />
          <text fg={colors.muted} height={3}>F8 refreshes. Enter chooses or edits. Partial setup is never selected or adopted. /profile shows observed revisions and explicit recovery. Esc returns.</text></box> :
        mode === "profile-recovery" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.attention} height={2}>Owned profile setup / {safe(profileEditor.current?.name ?? "Refresh with F8")}</text>
          <scrollbox height={10}><text fg={colors.foreground}>{safe(JSON.stringify(profileEditor.current, null, 2))}</text></scrollbox>
          <text fg={colors.muted} height={4}>Inspect the actual state-directory profiles/ID resource directory before retrying. A retry never adopts unsafe paths, copies accounts, or silently switches the client.</text>
          <ThemedSelect focused={!profilePending} flexGrow={1} options={[{ name: profileEditor.current?.status === "creating" ? "Stop this owned profile setup" : "I inspected owned resources: retry setup", description: "Explicit user action; partial effects are preserved.", value: "recover" }, { name: "Return without changing setup", description: "No retry or cancellation is inferred.", value: "return" }]} onSelect={(_, option) => { if (!option || switchingProfile.current) return; void perform(async () => {
            const profile = profileEditor.current;
            if (option.value === "return") { await openProfiles(); return; }
            if (!profile) throw new Error("Refresh the actual profile catalog with F8.");
            switchingProfile.current = true; setProfilePending(true);
            try {
              if (profile.status === "creating") await client.profiles.stop(profile.id);
              else { await client.profiles.retry(profile.id, profile.revision, true); await client.profiles.wait(profile.id); }
              await openProfiles();
            } finally { switchingProfile.current = false; setProfilePending(false); }
          }); }} /></box> :
        mode === "github-repositories" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>GitHub repositories / {safe(githubRepositories?.account ?? "")}</text>
          <text fg={colors.muted} height={3}>Your repositories and organizations come first on each page. Public visibility is not proof of an open-source license. SSH cloning uses your existing keys, not a copied gh token.</text>
          <ThemedSelect focused={!githubBusy} flexGrow={1} options={[...(githubRepositories?.repositories ?? []).map((repository) => ({ name: safe(repository.fullName), description: `${repository.relationship} / ${repository.visibility}`, value: String(repository.id) })),
            ...(githubRepositories?.nextPage ? [{ name: "Load next repository page", description: "Explicit bounded page, same account.", value: "next" }] : [])]} onSelect={(_, option) => {
            if (!option || githubBusy) return;
            if (option.value === "next" && githubRepositories?.nextPage) { void perform(() => openGithubRepositories(githubSearch.current.source, githubSearch.current.query, githubRepositories.nextPage!, githubRepositories.account, githubRepositories.accountId)); return; }
            const selected = githubRepositories?.repositories.find((entry) => String(entry.id) === option.value);
            if (selected) { setGithubRepository(selected); setProjectPath(""); setGithubCloneJob(null); setMode("github-clone"); }
          }} /><text fg={colors.muted} height={2}>Enter selects. /github repos public QUERY searches public repositories. Esc returns.</text></box> :
        mode === "github-clone" ? <box flexDirection="column" flexGrow={1} paddingTop={1} gap={1}>
          <text fg={colors.accent}>Clone {safe(githubRepository?.fullName ?? "")}</text>
          <text fg={colors.muted} height={4}>Enter a new absolute destination in an existing parent folder. Enter explicitly clones and starts an idle session. No hooks, submodules, model call or automatic authentication. Cancellation preserves partial files.</text>
          <ThemedInput focused={!githubBusy && !githubCloneJob} placeholder="/absolute/path/to/new-checkout" value={projectPath} onInput={setProjectPath} onSubmit={() => {
            if (!githubRepository || githubCloneJob || githubBusy) return;
            void perform(() => githubAction(async () => {
              const job = await client.projects.clone(githubRepository.sshUrl, projectPath, true); if (!job.id) throw new Error("Original clone was not acknowledged. Inspect jobs before retrying.");
              setGithubCloneJob(job.id);
              const result = await client.jobs.wait(job.id, { timeoutMs: 310_000 });
              if (result.status !== "completed" || !result.projectClone) throw new Error(result.error ?? `Original clone is ${result.status}; it was not retried.`);
              const created = await client.sessions.create(result.projectClone.projectId); await chooseSession(created.id!);
            }));
          }} />
          {githubCloneJob && <text fg={colors.attention}>{safe(`${githubCloneJob}: ${snapshot?.jobs.find((entry) => entry.id === githubCloneJob)?.status ?? "unobserved"}. Ctrl+C stops only this clone; partial files are preserved. Esc returns.`)}</text>}
        </box> :
        mode === "github-items" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>{safe(githubItems?.context.repository ?? "")} / {githubItems?.kind === "pull" ? "Pull requests" : "Issues"}</text>
          <text fg={colors.muted} height={2}>Controller GitHub CLI account: {safe(githubItems?.context.account ?? "")}. Enter reviews the exact full source before starting a session.</text>
          <ThemedSelect focused={!githubBusy} flexGrow={1} options={[...(githubItems?.items ?? []).map((item) => ({ name: safe(`#${item.number} ${item.title}`), description: item.draft ? "draft" : safe(item.state), value: String(item.number) })),
            ...(githubItems?.nextPage ? [{ name: "Load next page", description: "Same repository and account.", value: "next" }] : [])]} onSelect={(_, option) => {
            if (!option || !githubItems || githubBusy) return;
            if (option.value === "next" && githubItems.nextPage) { void perform(() => openGithubItems(githubItems.kind, githubItems.nextPage!)); return; }
            const number = Number(option.value), owner = githubOwner.current;
            void perform(() => githubAction(async () => {
              const value = await client.github.source(githubItems.scope, { kind: githubItems.kind, repository: githubItems.context.repository, account: githubItems.context.account, accountId: githubItems.context.accountId, number });
              if (JSON.stringify(value.binding) !== JSON.stringify(githubItems.context.binding)) throw new Error("The actual project root or policy changed. Reload its items before reviewing this source.");
              if (githubOwner.current !== owner) return;
              setGithubSelection({ ...value, scope: githubItems.scope }); setMode("github-detail");
            }));
          }} /><text fg={colors.muted} height={2}>No item is executed or attached by listing it. Esc returns.</text></box> :
        mode === "my-work" && snapshot ? <MyWorkTui sdk={client} snapshot={snapshot} filters={myWorkFilters} changeFilters={setMyWorkFilters} openSession={chooseSession}
          openExternal={async (url) => { if (!native) throw new Error("No native browser binding is available. Use the displayed canonical link; nothing was opened."); await native.browser(url); }} /> :
        mode === "github-detail" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>{safe(`${githubSelection?.source.repository}#${githubSelection?.item.number} ${githubSelection?.item.title}`)}</text>
          <scrollbox focused={!githubBusy} flexGrow={1}><text fg={colors.foreground}>{safe(`${githubSelection?.item.state}\n\n${githubSelection?.item.body ?? ""}\n\nController source workspace: ${githubSelection?.binding.root.root}\nSource SHA-256: ${githubSelection?.digest}`)}</text></scrollbox>
          <text fg={colors.attention} height={3}>Ctrl+N starts a session with this exact source as an unsent draft. Ctrl+L links it here. Ctrl+B opens GitHub. No checkout or inference is started. Esc returns.</text></box> :
        mode === "session-action" && archiveReview ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Archive {safe(archiveReview.session.title)}{archiveReview.children.length ? " and review its subsessions" : ""}</text>
          {archiveReview.running.length > 0 && <text fg={colors.error} height={2}>{safe(`${runningSessionNames(archiveReview.running)} ${archiveReview.running.length === 1 ? "is" : "are"} still running. Archiving stops ${archiveReview.running.length === 1 ? "its" : "their"} current work. You always confirm this, even with saved preferences.`)}</text>}
          {archiveReview.children.length > 0 && <text fg={colors.muted} height={3}>{safe([...archiveReview.children.slice(0, 12).map((child) =>
            `${child.parentSessionId === archiveReview.session.id ? "" : "  nested: "}${child.title}`),
          ...(archiveReview.children.length > 12 ? [`... and ${archiveReview.children.length - 12} more`] : [])].join("\n"))}</text>}
          {archiveReview.children.length > 0 && <text fg={colors.attention} height={3}>Cascade archives this exact tree. Detach retains direct child sessions and their nested hierarchy after settling owned work. Model-owned subagents cannot be detached. Esc cancels.</text>}
          <ThemedSelect focused={!archivePending} flexGrow={1} options={!archiveReview.children.length ? [
            { name: "Stop running work and archive", description: "Stop this session's current work, then archive it. History and drafts are kept.", value: "archive" },
            { name: "Cancel", description: "No session action; the work keeps running.", value: "cancel" },
          ] : [
            { name: "Archive all attached subsessions", description: "Settle owned work and archive every descendant in the reviewed tree.", value: "archive" },
            ...(archiveReview.canDetach ? [{ name: "Detach direct children", description: "Settle owned work, preserve the sessions, and keep nested sessions attached.", value: "detach" }] : []),
            { name: "Archive all and don't ask me again", description: "Save this profile's archive-child choice.", value: "archive:remember" },
            ...(archiveReview.canDetach ? [{ name: "Detach direct children and don't ask me again", description: "Settle owned work and save this profile's detach-child choice.", value: "detach:remember" }] : []),
            { name: "Cancel", description: "No session action.", value: "cancel" },
          ]} selectedBackgroundColor={colors.panel} selectedTextColor={colors.accent} textColor={colors.foreground} descriptionColor={colors.muted}
            onSelect={(_, option) => {
              const choice = String(option?.value ?? "");
              if (choice === "cancel") { queuedArchive.current?.settle({ outcome: "cancelled", diagnostic: "The actual user cancelled this archive review." }); setArchiveReview(null); setMode("compose"); return; }
              const [action, memory] = choice.split(":");
              if (action !== "archive" && action !== "detach") return;
              if (action === "detach" && !archiveReview.canDetach) return;
              const review = archiveReview;
              void perform(async () => {
                const owned = queuedArchive.current;
                if (owned?.pending) return;
                if (owned) { owned.pending = true; setArchivePending(true); }
                try { await applyArchiveChoice(review, action, memory === "remember"); }
                finally { if (queuedArchive.current === owned) { if (owned) owned.pending = false; setArchivePending(false); } }
              });
            }} />
        </box> :
        mode === "continue-work" && continueReview ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Continue work / choose for this request</text>
          <text fg={colors.muted} height={4}>{queuedContinue.current?.cancelling ? "Restoring the original draft. Wait for its actual service acknowledgement before another input." :
            "Work from Kanban, or send this exact prompt to the model? Esc cancels and preserves the draft. No route is remembered."}</text>
          <ThemedSelect flexGrow={1} focused={!continuePending} options={[
            { name: "Work from Kanban", description: "One actual project item in an isolated Local checkout, through its PR", value: "kanban" },
            { name: "Send to model", description: "Send the unchanged prompt through the normal chat and permissions", value: "prompt" },
          ]} selectedBackgroundColor={colors.panel} selectedTextColor={colors.accent} textColor={colors.foreground} descriptionColor={colors.muted}
            onSelect={(_, option) => { if (option?.value === "kanban" || option?.value === "prompt") {
              const choice = option.value, review = continueReview;
              void perform(async () => {
                const owned = queuedContinue.current;
                if (owned) {
                  if (owned.pending) return;
                  owned.context.signal.throwIfAborted(); owned.pending = true; setContinuePending(true);
                  try { await client.commands.choose(owned.context.clientId, owned.context.claim, choice); owned.settle({ outcome: "completed" }); }
                  finally { if (queuedContinue.current === owned) { owned.pending = false; setContinuePending(false); } }
                  return;
                }
                if (!editor || editor.sessionId !== review.sessionId) throw new Error("The original continuation owner changed. No draft was consumed.");
                await editor.chooseContinueWork(review, choice);
                setContinueReview(null); setMode("compose");
              });
            } }} />
        </box> :
        mode === "schedule" && session && editor ? <TuiScheduleDialog sdk={client} editor={editor} initial={scheduleInitial}
          lock={(pending) => { schedulePending.current = pending; }} close={() => setMode("compose")} /> :
        mode === "automations" ? <TuiScheduledPrompts sdk={client} prompts={snapshot?.scheduledPrompts ?? []} run={perform} /> :
        mode === "question" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Actual user question / no tool permission grant</text>
          {pendingQuestion ? <><scrollbox height={compact ? 4 : 10}><text fg={colors.foreground}>{safe(questionDetails)}</text></scrollbox>
            <ThemedSelect focused flexGrow={1} options={[...pendingQuestion.choices.flatMap((choice, index) => choice === "Other, please specify" ? [] : [{ name: safe(choice), description: "Answer as the actual user. Does not authorize tools.", value: `choice:${index}` }]), { name: "Other, please specify", description: "Type a custom answer in the saved composer. Enter submits; Cmd/Ctrl+Enter still holds.", value: "other" }, ...(pendingQuestion.allowFreeform ? [{ name: "Type a freeform answer in the saved composer", description: "Enter answers; Cmd/Ctrl+Enter still holds a queue.", value: "freeform" }] : [])]} onSelect={(_, option) => {
              if (!option) return;
              if (option.value === "other" || option.value === "freeform") { setOtherQuestion(option.value === "other" ? pendingQuestion.id : null); setMode("compose"); setNotice("Type your actual answer. Enter answers; Shift+Enter inserts a newline. Cmd/Ctrl+Enter still queues."); return; }
              const index = Number(String(option.value).slice(7)), choice = pendingQuestion.choices[index];
              if (choice === undefined) { setNotice("This offered answer is no longer available. Review the current question."); return; }
              void perform(async () => { await client.questions.answer(pendingQuestion.id, choice, pendingQuestion.revision); setMode("compose"); });
            }} /></> : <text fg={colors.muted}>This question was answered or cancelled. Esc returns without inventing an answer.</text>}
          <text fg={colors.muted} height={3}>Never enter credentials. Use connection settings. Source provenance is retained; model confidence cannot grant policy. Esc returns.</text></box> :
        mode === "themes" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Shared color palettes / {appearance.palette ?? "moguri"} / {appearance.theme}</text>
          <ThemedSelect focused flexGrow={1} options={themePalettes.map((palette) => ({ name: `${palette.id === (appearance.palette ?? "moguri") ? "* " : ""}${palette.name}`, description: palette.description, value: palette.id }))}
            onSelect={(_, option) => { const palette = themePalettes.find((palette) => palette.id === option?.value); if (!palette) return;
              void perform(async () => { const current = client.settings.get(); if (!current) throw new Error("Shared settings are unavailable.");
                await client.settings.update({ ...current.values, appearance: { ...current.values.appearance, palette: palette.id } }, current.revision);
                setNotice(`Shared palette set to ${palette.name}. Mode and custom colors are preserved.`);
              }); }} />
          <text fg={colors.muted} height={3}>Enter selects. /theme PALETTE dark|light|system changes mode explicitly. Desktop resolves System from the OS; TUI uses terminal theme reports, or Dark when unavailable. Esc returns.</text>
        </box> :
        mode === "settings" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent}><strong>Shared Moguri SDK settings</strong></text><text fg={colors.muted}>Same settings and APIs as desktop. Optional subagents/evolution start off.</text>
          <ThemedSelect focused flexGrow={1} options={[
            { name: "System prompt: view, edit, restore", value: "prompt" },
            { name: "Appearance: shared color palettes", value: "appearance" },
            { name: "Integration order: MCP via Gateway, MCP direct, REST, CLI", value: "tool-preferences" },
            { name: "All shared settings (JSON): dark theme, guardrails, memory, MCP, optional modes", value: "json" },
            { name: "Project settings (JSON): repo, folders, scripts, preview port, instructions and MCP", value: "project" },
            { name: "Pull request automation: effective flags, repository exceptions and this chat's retries", value: "pr-automation" },
            { name: "View effective committed system prompt", value: "preview" },
            { name: "Index current repository locally", value: "index" },
            { name: "Read repository import/symbol graph", value: "graph" },
            { name: "Discover foundational internal MCP scripts", value: "mcp" },
            { name: "Skills, plugins and pending proposals", value: "registry" },
            { name: "Local Nemotron dictation setup/status", value: "voice" },
            { name: "Local project Kanban issues", value: "issues" },
            { name: "Configure issue phases and optional Linear (JSON)", value: "board" },
            { name: "Inspect shared npm dependency cache plan", value: "cache" },
            { name: "Command help: skill imports, review, MCP auth and subagents", value: "help" },
          ].map((option) => ({ ...option, description: "" }))} onSelect={(_, option) => { void perform(async () => {
            switch (option?.value) {
              case "appearance": setMode("themes"); break;
              case "tool-preferences": if (!session) throw new Error("Choose a chat before using /tool-preferences to review or rank this profile's integration methods."); await slashResult(await client.slash(session.id, "/tool-preferences", "tui")); break;
              case "prompt": openSettingsEditor(true); break;
              case "json": openSettingsEditor(false); break;
              case "project": await openProjectEditor(); break;
              case "pr-automation": {
                if (!snapshot) throw new Error("Connect before reading pull request automation.");
                const configuration = project ? snapshot.projectConfigurations.find((value) => value.projectId === project.id)?.values : undefined;
                show({ defaults: prAutomationDefaults(snapshot.settings.values),
                  repository: configuration ? Object.values(effectivePrAutomation(snapshot.settings.values, configuration)).map((flag) => `${PR_AUTOMATION_LABELS[flag.flag]}: ${prAutomationSourceLabel(flag)}`) : "Open a project to see its effective values.",
                  exceptions: prAutomationExceptions(snapshot.settings.values, snapshot.projectConfigurations),
                  records: session ? client.prAutomation.records(session.id) : [],
                  edit: "Change defaults under prAutomation in All shared settings (JSON) and overrides under repo.ciRetry / repo.conflictResolution in Project settings (JSON). Remove an override to inherit." });
                break;
              }
              case "preview": show(await client.prompt.preview(session?.id)); break;
              case "index": if (!project) throw new Error("Open a project first."); show(await client.memory.index(project.id, session?.workspaceId ?? undefined)); break;
              case "graph": if (!project) throw new Error("Open a project first."); show(await client.memory.graph(project.id, "", session?.workspaceId ?? undefined)); break;
              case "mcp": show(await client.mcp.tools("builtin", "", 0, session?.id)); break;
              case "registry": show({ registry: snapshot?.registry, proposals: snapshot?.proposals }); break;
              case "voice": show(await client.voice.status()); break;
              case "issues": setMode("issues"); break;
              case "board": openBoardEditor(); break;
              case "cache": if (!project) throw new Error("Open a project first."); show(await client.cache.inspect(project.id, "npm", session?.workspaceId ?? undefined)); break;
              case "help": setMode("help"); break;
            }
          }); }} />
          <text fg={colors.muted}>Prompt edits can break functionality. Hard permissions remain final.</text>
        </box> :
        editorModes.includes(mode) ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          {mode === "artifact-editor" && snapshot?.decisions.some((record) => record.id === artifactEditor.current?.id) ?
            <text fg={colors.accent} height={4} flexShrink={0}>Decision metadata only. Original typed request, actual model input/result, actor and applied/rejected observations are immutable. Ctrl+Enter saves metadata; Esc discards. /decisions inspects data, never answers, approves or infers user facts.</text> :
            mode === "artifact-editor" && snapshot?.winddowns.some((record) => record.id === artifactEditor.current?.id) ?
            <text fg={colors.accent} height={4} flexShrink={0}>Wind-down metadata only. Reserved capacity, actual model input/result and separate user source/Git reviews are immutable. Ctrl+Enter saves metadata; Esc discards. /winddown reads exact source/Git/effect reviews; acceptance never comes from metadata or model advice.</text> :
            mode === "artifact-editor" && snapshot?.compoundWorkflows.some((workflow) => workflow.id === artifactEditor.current?.id) ?
            <text fg={colors.accent} height={4} flexShrink={0}>Compound workflow metadata only. Exact source/cost intent, actual role results, user staging/test decisions and command evidence are immutable. Ctrl+Enter saves metadata; Esc discards. /compound reads data, not permission or source acceptance.</text> :
            mode === "artifact-editor" && (snapshot?.sandboxExecutions?.some((value) => value.id === artifactEditor.current?.id) || snapshot?.sandboxPublications?.some((value) => value.id === artifactEditor.current?.id)) ?
            <text fg={colors.accent} height={4} flexShrink={0}>Native report metadata only. Original input/results, VM ownership, source-copy acceptance and attempts are immutable. Ctrl+Enter saves metadata; Esc discards. /sandbox inspects data, never implies permission or code quality.</text> : <>
          {mode === "plan-editor" ? <text fg={colors.accent} height={5} flexShrink={0}>Exact {planEditor.current?.env} plan / {safe(planEditor.current?.boundary ? `${planEditor.current.boundary.root}/${planEditor.current.path}` : planEditor.current?.path ?? "")}. Edit text only. Ctrl+Enter writes and retains this reviewed binding; Esc discards before saving. No model call or Local fallback. Partial outcomes preserve the editor.</text> : mode === "profile-editor" ? <text fg={colors.accent} height={4} flexShrink={0}>Profile metadata only. Use a display name and null or #RRGGBB color. No account, project or model context is copied. Ctrl+Enter saves; Esc discards. Creation does not switch scope.</text> : mode === "artifact-editor" ? <text fg={colors.accent} height={4} flexShrink={0}>{snapshot?.roleSequences.some((sequence) => sequence.id === artifactEditor.current?.id) ? "Role sequence metadata only. Original input and actual per-role observations are immutable. Ctrl+Enter saves metadata; Esc discards. /roles inspects data, never calls a model." : snapshot?.candidateGenerations.some((generation) => generation.id === artifactEditor.current?.id) ? "Generation metadata only. Input/result bytes and model provenance are immutable. Ctrl+Enter saves metadata; Esc discards. No file or model action." : snapshot?.candidates.some((candidate) => candidate.id === artifactEditor.current?.id) ? "Candidate metadata only. Exact proposal bytes are immutable; use /candidate for separate review/application. Ctrl+Enter saves metadata; Esc discards." : "Independent retained document. Only text is copied; model provenance is preserved. Ctrl+Enter saves; Esc discards this edit. Editing does not publish a file or grant permissions."}</text> : mode === "project-editor" ? <text fg={colors.attention} height={3} flexShrink={0}>Project policy and bindings. Save never runs scripts or publishes defaults. Ctrl+Enter saves; Esc discards.</text> : mode === "issue-editor" || mode === "board-editor" ? <text fg={colors.accent} height={3} flexShrink={0}>{mode === "issue-editor" ? "Local project issue. No assignee or hosted upload. Ctrl+Enter saves; Esc discards." : "Board phases, merged-PR destination, read-only GitHub access and optional Linear team. Ctrl+Enter saves; Esc discards."}</text> : <>
          <text fg={colors.attention} height={width >= 100 ? 3 : 4} flexShrink={0}>{SYSTEM_PROMPT_WARNING}</text><text fg={colors.muted} height={2} flexShrink={0}>Ctrl+Enter acknowledges risk and saves. Ctrl+R restores defaults. Esc cancels.</text></>}
          </>}
          {planPending ? <box flexDirection="column" flexGrow={1}><text fg={colors.attention} height={3}>Saving exact owned plan. Ctrl+C requests this save's stop; the editor stays preserved until settlement.</text><scrollbox flexGrow={1}><text fg={colors.foreground}>{safe(settingsText)}</text></scrollbox></box> : <SettingsTextEditor value={settingsText} change={setSettingsText} submit={(text) => void saveSettings(text)} />}
        </box> :
        mode === "artifacts" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Independent retained documents</text><text fg={colors.muted} height={3}>Ordinary artifacts survive session deletion. Candidates and generation proposals are deleted with their origin session or verified exact PR merge. Archiving alone preserves them. Provenance never grants permission.</text>
          <ThemedSelect focused flexGrow={1} options={[{ name: "+ New retained document", description: "Plan, decision, answer, research note or report.", value: "" }, ...(snapshot?.artifacts ?? []).map((artifact) => ({ name: safe(artifact.name), description: `${artifact.kind} / ${artifact.status} / revision ${artifact.revision} / ${artifact.projectId ? snapshot?.projects.find((project) => project.id === artifact.projectId)?.name ?? "Former project" : "Profile"}`, value: artifact.id }))]} onSelect={(_, option) => { if (option) void perform(() => openArtifact(String(option.value) || undefined)); }} />
          <text fg={colors.muted} height={3}>Enter edits text, folderId and workItemId. /artifact ID reads provenance. /project-removal materialize-preview reviews a repository copy. F5 works without a session. Esc returns.</text></box> :
        mode === "work-items" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Project work item / {safe(project?.name ?? "Choose a project")}</text>
          <ThemedSelect focused flexGrow={1} options={[{ name: "GitHub issues", description: "Read this project's actual signed-in account.", value: "github" },
            { name: "Clear Kanban work item", description: "Metadata only; no card is deleted.", value: "" }, ...localIssues.map((issue) => ({ name: `#${issue.number} ${safe(issue.title)}`,
              description: issue.linear ? `Linear ${safe(issue.linear.identifier)} / retained local card` : "Project Kanban card / no inference", value: issue.id }))]}
            onSelect={(_, option) => { if (!option || !session) return; void perform(async () => {
              if (option.value === "github") { await openGithubItems("issue"); return; }
              await client.sessions.organize(session.id, { workItemId: String(option.value) || null, ...(option.value ? { workItemUrl: null } : {}) }); setMode("compose"); setNotice("Kanban work item updated.");
            }); }} />
          <text fg={colors.muted} height={3}>Enter links a card, or opens the GitHub picker. /continue-work [CARD_ID] asks Kanban or model for this request. Esc returns.</text></box> :
        mode === "issues" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Local project Kanban / {safe(project?.name ?? "Open a project first")}</text>
          <text fg={colors.muted} height={3}>{board?.columns.map((column) => `${safe(column.name)}: ${localIssues.filter((issue) => issue.phaseId === column.id).length}`).join("  |  ") ?? "No project selected."}</text>
          <ThemedSelect focused flexGrow={1} options={[{ name: "+ New local issue", description: "Feature, bug or misc. No assignee.", value: "" }, ...localIssues.map((issue) => ({
            name: `#${issue.number} ${safe(issue.title)}`, description: `${issue.kind} / ${safe(board?.columns.find((column) => column.id === issue.phaseId)?.name ?? issue.phaseId)}${issue.pullRequest ? ` / PR ${issue.pullRequest.state}` : ""}`, value: issue.id,
          }))]} onSelect={(_, option) => { if (option) void perform(async () => openIssueEditor(String(option.value) || undefined)); }} />
          <text fg={colors.muted} height={4}>Enter edits JSON. /continue-work [CARD_ID] asks Kanban or model each time. /work-item picks a card. /kanban source selects open GitHub work. /board edit configures phases/sync/Linear. Esc opens this board's chat.</text></box> :
        mode === "runtime-review" ? <box flexGrow={1} flexDirection="column">
          <text fg={colors.accent} height={2}>Exact runtime version review / {runtimeActionsFocused ? "choices focused" : "preview focused"}</text>
          {runtimePreview && runtimePreview.target.profileId === client.profileId && runtimePreview.target.sessionId === session?.id &&
            runtimePreview.target.env === session.controls.env ? <>
            <scrollbox flexGrow={1} minHeight={0} focused={!runtimeActionsFocused}><text fg={colors.foreground}>{safe(JSON.stringify(runtimePreview, null, 2))}</text></scrollbox>
            {runtimeBusy ? <text fg={colors.muted} height={3}>Reading the exact reviewed version. Esc or Ctrl+C cancels only this probe, never the owning model/guest.</text> :
              <ThemedSelect focused={runtimeActionsFocused} height={5} flexShrink={0} options={[
                { name: "Cancel without a runtime attempt", value: "cancel", description: "Preserve the model and unsent prompt." },
                { name: "Approve once and read version", value: "approve", description: "Exact fixed --version only; no model, server, download or tool grant." },
              ]} onSelect={(_, option) => {
                if (option?.value === "approve") approveRuntime();
                else if (option?.value === "cancel") { setRuntimePreview(null); setMode("models"); }
              }} />}
          </> : <text fg={colors.error}>The original runtime review owner changed. No substitute is available; Esc returns.</text>}
          <text fg={colors.muted} height={2}>Tab switches the scrollable exact preview and choices. Review all fields. Esc exits without stopping the agent.</text>
        </box> :
        mode === "capability-output" ? <scrollbox key="command-output" flexGrow={1} minHeight={0} focused><text fg={colors.foreground}>{safe(capabilityOutput)}</text></scrollbox> :
        mode === "mcp-token" ? <box flexDirection="column" flexGrow={1} paddingTop={2}><text fg={colors.accent}>{tokenKind === "linear" ? "Linear personal API key" : tokenKind === "hosted-key" ? `${tokenServer} API key` : tokenKind === "hosted-code" ? `${tokenServer} sign-in redirect URL` : tokenKind === "cache" ? `Private registry credential for ${tokenServer}` : tokenKind === "model" ? `Local model credential for ${tokenServer}` : tokenKind === "otlp-header" ? `OTLP exporter header ${(JSON.parse(tokenServer) as string[])[1]} for ${(JSON.parse(tokenServer) as string[])[0]}` : `MCP credential for ${tokenServer}`}</text><text fg={colors.muted}>This masked input is not a draft or model message. Enter stores it in the OS keychain; Esc discards it.</text><text fg={colors.foreground}>{"*".repeat(Math.min(tokenValue.length, 60))}</text></box> :
        mode === "project" ? <box flexDirection="column" paddingTop={2} gap={1}><text fg={colors.accent}>Open a local project directory</text><text fg={colors.muted}>Local execution is not sandboxed. Tools follow the selected autonomy and hard policy.</text>
          <ThemedInput focused value={projectPath} onInput={setProjectPath} placeholder="/absolute/path/to/project" onSubmit={() => void perform(() => openProject(projectPath))} /></box> :
        mode === "repository-import" ? <box flexGrow={1} flexDirection="column" padding={1}>
          <text fg={colors.accent} height={2}>{safe(repositoryPrompt ? `Import ${repositoryPrompt.root} as a project and move this chat?` : "This chat has no pending repository proposal.")}</text>
          <text fg={colors.muted} height={2}>The chat and its child chats move into the repository; later turns run there. Esc keeps it in Home.</text>
          {repositoryPrompt && <ThemedSelect focused flexGrow={1} options={[
            { name: "Import and move", description: "Ask again next time.", value: "import" },
            { name: "Import and move, don't ask again", description: "Saves this profile's preference to import observed repositories automatically.", value: "remember" },
            { name: "Not now", description: "Dismiss this proposal; the same repository is not proposed again.", value: "dismiss" },
          ]} onSelect={(_, option) => {
            if (!option || !repositoryPrompt) return;
            void perform(async () => {
              if (option.value === "dismiss") { await client.sessions.dismissRepository(repositoryPrompt.sessionId, repositoryPrompt.revision); setMode("compose"); return; }
              await importRepository(option.value === "remember");
            });
          }} />}
        </box> :
        mode === "kupo-mode" ? <box flexGrow={1} flexDirection="column" padding={1}><text fg={colors.accent} height={2}>Kupo modes / actual effort is model-selected</text>
          <text fg={colors.muted} height={4}>Balanced uses declared capabilities. Savings/Performance require reviewed evaluation and reference-price profiles. Performance never drops below xhigh. Context is always the selected model's qualified maximum. No permission or source acceptance is delegated here.</text>
          {kupoOptionError && <text fg={colors.error} height={3}>{safe(kupoOptionError)}</text>}
          {!kupoOptions.length ? <text fg={colors.muted}>Reading shared mode readiness...</text> : <ThemedSelect focused={!kupoSaving} flexGrow={1}
            options={kupoModes.map((mode) => {
              const ready = kupoOptions.find((option) => option.mode === mode.id);
              return { name: `${session?.controls.kupoMode === mode.id ? "* " : ""}${mode.name}${ready?.available ? "" : " [unavailable]"}`, value: mode.id, description: ready?.reason ?? "Readiness unknown" };
            })} onSelect={(_, option) => {
              const mode = kupoModes.find((mode) => mode.id === option?.value), ready = kupoOptions.find((entry) => entry.mode === mode?.id);
              if (!mode || !session || kupoPending.current) return;
              if (!ready?.available || session.turnId) { setNotice(session.turnId ? "Stop the owning turn before changing its Kupo mode." : ready?.reason ?? "Mode readiness is unknown.", true); return; }
              kupoPending.current = true; setKupoSaving(true);
              void perform(async () => { try { await client.sessions.kupoMode(session.id, mode.id, session.revision); setMode("compose"); }
                finally { kupoPending.current = false; setKupoSaving(false); } });
            }} />}
          <text fg={colors.muted} height={3}>Automatic text compaction is opt-in. Finite roles require a qualified selected-Env finishing hold. Real Jev remains unqualified; configured bounded alternatives need their actual readiness. /kupo inspects exact policy; Esc returns without changing it.</text>
        </box> :
        mode === "models" ? <box flexGrow={1} flexDirection="column" paddingTop={1}><text fg={colors.accent}>Select an available model</text>
          {availableModels.length || readinessModels.length ? <ThemedSelect focused flexGrow={1} options={[...availableModels.map((model) => ({ name: model.name, description: model.synthetic ?
            model.environments && !model.environments.includes(session?.controls.env ?? "Local") ? `Unavailable: ${snapshot?.routingDiagnostics?.join(" ") ?? "No eligible model in this environment."}` :
              snapshot?.settings.values.kupo.workflow === "auto" ? "Automatic Single / Cascade / eligible Critique; every actual role is metered" :
                snapshot?.settings.values.kupo.workflow === "compound" ? "Moguri reviewed compound / separately metered actual roles" : "Moguri Single alpha / separately metered router and solver" : `${model.contextWindow} context tokens / ${model.source === "local" ? model.providerId : model.source === "claude-agent" ? "your installed Claude Code" : model.source === "codex-agent" ? "your installed Codex" : model.source === "hosted" ? hostedProvider(model.providerId ?? "")?.name ?? "hosted account" : "GitHub Copilot"}`, value: model.id })),
              ...readinessModels.map((model) => ({
                name: `Inspect runtime and hardware / ${model.name}`, description: "Read-only on the selected execution machine; no model selection, inference or installation.",
                value: `readiness:${model.id}`,
              })),
              ...readinessModels.map((model) => ({
                name: `Review exact runtime version / ${model.name}`, description: "Separate actual-user review of a configured compatible immutable llama.cpp command; no model selection.",
                value: `runtime-review:${model.id}`,
              }))]}
            onSelect={(_, option) => {
              if (!session) { setNotice("Create a chat with Ctrl+N before choosing its model."); return; }
              if (typeof option?.value === "string" && option.value.startsWith("readiness:")) {
                const model = readinessModels.find((model) => `readiness:${model.id}` === option.value);
                if (!model) { setNotice("The original configured model is unavailable. No provider or root was substituted.", true); return; }
                void perform(async () => showReadiness(await client.models.readiness(session.id, model.id)));
                return;
              }
              if (typeof option?.value === "string" && option.value.startsWith("runtime-review:")) {
                const model = readinessModels.find((model) => `runtime-review:${model.id}` === option.value);
                if (!model) { setNotice("The configured runtime owner is no longer available. No source was substituted.", true); return; }
                previewRuntime(model.id); return;
              }
              const model = availableModels.find((model) => model.id === option?.value);
              if (model?.environments && !model.environments.includes(session.controls.env)) { setNotice(`Kupo is unavailable in ${session.controls.env}. ${snapshot?.routingDiagnostics?.join(" ") ?? ""}`); return; }
              if (option?.value) void perform(async () => { await client.sessions.selectModel(session.id, String(option.value), session.revision); setMode("compose"); });
            }} /> :
            <text fg={colors.muted}>{session?.controls.env === "Remote" ? "No model approved on this SSH host. Use /remote probe; explicitly allow scoped Copilot access or configure remote endpoints." : "No available models. Ctrl+L connects Copilot; /local-models explains explicit local endpoint setup."}</text>}
          <text fg={colors.muted} height={4} flexShrink={0}>Kupo uses configured models. F11 selects its routing mode; /thinking and /context-window keep exact pooled controls. Runtime inspection is read-only and can observe an original active SSH/native owner without changing its model. /compound keeps separate worktree/test review.</text></box> :
        mode === "sessions" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Choose a session</text>
          <ThemedSelect focused={!navigationFocus} flexGrow={1} options={options}
            onSelect={(_, option) => { if (option?.value) void perform(() => chooseSession(String(option.value))); }} />
          <text fg={colors.muted} height={2}>Enter opens a saved session. /new creates one. Esc returns without sending your draft.</text></box> :
        mode === "code-requests" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Session code requests</text>
          <text fg={colors.muted} height={compact ? 3 : 2}>Pull requests and code-change review for this project. Listing retained links does not contact GitHub or run a model.</text>
          <ThemedSelect focused={!navigationFocus} flexGrow={1}
            options={[
              { name: "Review current code changes", description: "Read the actual session-bound diff; no write or inference.", value: "diff" },
              { name: "Browse project pull requests", description: session?.projectId && session.controls.env === "Local" ? "Explicit GitHub lookup using this project's configured account." : "Blocked: needs an individual Local project; no fallback.", value: "browse" },
              ...(snapshot?.sessions.filter((value) => value.projectId === session?.projectId && (!value.repositories && (session?.projectId !== null || value.id === session?.id)) && sessionPullRequestUrl(value, snapshot)) ?? []).map((value) => ({
                name: safe(value.title), description: safe(`${sessionPullRequest(value, snapshot!)?.state ?? "unverified"} / ${sessionPullRequestUrl(value, snapshot!)}`), value: value.id,
              })),
            ]} onSelect={(_, option) => {
              if (!option) return;
              void perform(async () => {
                if (!session) throw new Error("Choose an existing session first.");
                if (option.value === "diff") { await slashResult(await client.slash(session.id, "/diff", "tui")); return; }
                if (option.value === "browse") { await openGithubItems("pull"); return; }
                const owner = snapshot?.sessions.find((value) => value.id === option.value);
                if (!owner || !snapshot) throw new Error("This retained code request is no longer available.");
                show({ sessionId: owner.id, title: owner.title, url: sessionPullRequestUrl(owner, snapshot), observation: sessionPullRequest(owner, snapshot),
                  note: "Retained observation, not a fresh lookup. /github pulls explicitly browses this project; /pr explicitly opens the current session's linked PR." });
              });
            }} />
          <text fg={colors.muted} height={2}>Enter reviews a selection. /github pulls browses; /diff reads changes. Esc returns.</text>
        </box> :
        mode === "help" ? <scrollbox flexGrow={1} focused><text fg={colors.foreground}>{`Commands / no shortcut chords required for navigation

/session  /sessions  /work-items  /code-requests
/sidebar open|close  /theme list  /theme crystal dark
/new [global]  /open PATH  /models  /profiles  /settings
/otlp status | review INPUT_JSON | apply REVIEW_JSON confirm-reviewed | credential set|remove ENDPOINT NAME
/stainless status | check | open [URL]
/automations [list | runs ID | enable ID | pause ID | run ID | stop RUN_ID | delete ID [stop-running]]
/approve once  /question  /queue  /stop  /quit

Click any navigation tab. Tab focuses navigation; Up/Down chooses a tab,
Enter opens it. Left closes the sidebar; Right opens it only in navigation.
Tab or Esc returns. Composer arrows always edit text.
Type / for commands. Up/Down selects; Tab or click fills without execution.
Idle Enter executes the exact command when no earlier work exists.
Held/ordered new view/theme commands stay unsent until shared intake integration.
Esc returns to the current saved prompt.

Enter sends; Shift+Enter is newline; Cmd/Ctrl+Enter holds without running.
Shift+Cmd/Ctrl+Enter sends now. Ctrl+C saves and leaves this TUI; /stop stops the turn.
Existing shortcut aliases remain available for compatibility.

/connect | /cancel-login | /disconnect | /models | /model ID
/connect chatgpt|openrouter signs in; /api-key openrouter|anthropic|openai opens masked key input; /login-code PROVIDER pastes a redirect URL
/disconnect PROVIDER removes a hosted provider's stored credential
/model-settings [JSON|reset] configures working context/thinking via the shared SDK
/local-models [refresh] inspects configured endpoints without inference or host scans
/remote [probe|reconcile ID|acknowledge ID] uses pinned SSH, never Local fallback
/remote-model-token ENDPOINT opens masked remote endpoint credential input
/model-token ENDPOINT opens a masked endpoint-key input; /defaults shows startup sources
/new global creates a chat without a workspace
/meta [REQUEST] | /suggestions [all|run DIGEST|run-all DIGEST] | /inbox [read ID|delete ID]
/config list|review ID|apply ID SHA256 acknowledge-risk|reject ID SHA256
/mcp login SERVER | /mcp cancel AUTH_ID | /mcp clear-oauth SERVER
/notifications shows shared attention preferences and current items
/env Local | /autonomy Manual | /budget status
/budget set TOKENS|- USD|- confirm-estimates | /dashboard
/profiles | /profile [use ID|create NAME|rename ID REV NAME|retry ID REV confirm-review]
/attach project/path.txt  (explicit @ project-file snapshot)
/detach path-or-ID removes an attached snapshot
/steer text | /interrupt text | /stop | /resume
/queue | /edit ID text | /remove ID | /reorder ID ID ...
/queue-turn ID converts an unapplied steer into a new turn
/send-now ID steers a queued prompt into the running turn, or runs it next
/archive | /restore | /new | /open PATH | /sessions
/trace | /details | /reload-draft | /keep-draft
/policy all | /policy protected
/settings | /settings edit | /settings reset SECTION
/tool-preferences [mcp-gateway mcp-direct rest cli|reset]
/impeccable [PROMPT] | /continue (original task, no new prompt)
/suggestions [all|session|run DIGEST|run-all DIGEST]
/orchestrate PROMPT | /spawn PROMPT | /spar PROMPT
/critique PROMPT | /roast-me PROMPT (read-only work critique)
/project-settings [edit] | /project-sources | /porto
/prompt | /prompt view | /prompt reset
/memory index|graph|search TEXT|remember CONVENTION
/skills import SKILL.md | /plugins import manifest.json
/capabilities | /capability view|enable|disable ID
/proposal view ID | /proposal approve|reject ID SHA256
/mcp servers | /mcp tools SERVER QUERY | /mcp auth SERVER
/mcp-remote preview SERVER | grant SERVER SHA256 REV confirm-reviewed [forward-access]
/mcp-remote revoke SERVER REV confirm-revoke | calls | inspect OPERATION_ID
/mcp token SERVER (dedicated masked input, never a draft)
/mcp call SERVER TOOL SHA256 JSON | /scripts | /result JOB_ID
/subagent PROMPT (only when explicitly enabled)
/dictate status|download accept-license|record|stop|file WAV|insert
/issues | /issue new | /issue create feature|bug|misc TITLE
/kanban [show|hide|source kanban|github-issues|github-prs]
/continue-work [CARD_ID] | /work-item [CARD_ID|clear]
/issue edit ID | /issue move ID PHASE | /issue archive|restore ID
/board | /board edit | /board refresh
/cache inspect npm|pnpm
/cache prepare MANAGER SHA256 accept-metadata
/cache install MANAGER SHA256 accept-metadata replace-node-modules
/linear status|token|clear-token|import CURSOR (optional, off by default)

${tuiCommands.map((entry) => `/${entry.name}${entry.argument ? ` ${entry.argument}` : ""}  ${entry.description}`).join("\n")}
${skillHelp?.profileId === client.profileId ? safe(skillHelp.text) : ""}

Native Sandbox uses /sandbox setup for bundled runtime/image review, followed
by its exact /sandbox enable command. Managed workspaces and selected-provider
DNS aliases are automatic; /sandbox updates never changes the selected version.
Advanced exact-file staging remains optional. Source publication is separate
actual-user acceptance. /compound owns reviewed Local Cascade/Critique
and separately approved project tests. /winddown inspects reserved finishing at
its actual Local/SSH/native boundary. Accepted-work Git needs separate source
and branch reviews on the original peer or disclosed native-model/Local source.
Partial effects require their exact inspect/reconcile confirmation, never replay.
Max technical/steering advice needs an explicitly
configured bounded decision provider; /decisions status/set/read exposes only
shared policy and actual evidence, never a fake user answer or new permission.
SSH/native advice stays inside the original parent, not a Local fallback. Jev is unqualified.
Kupo is always listed. Select /model kupo to use configured eligible models.
/kupo status shows capability categories and policy. Finite automatic caps need
complete all-role reservations and qualified selected-Env finishing;
legacy Single and reviewed worktree workflows need explicit reserved
wind-down; images and model tuning remain blocked for Single. Guided needs a human.
Selecting Autopilot/Max enables automatic tool approvals, never hard-policy overrides.
Ctrl+Shift+Y remembers approvals; /github repos, issues and pulls open native pickers.
Bare attachment prefixes stay literal.

Protected policy blocks all new Local turns in this checkpoint.
Only turns already running at the policy boundary may finish.

Copilot uses pi-ai's third-party device flow. A subscription and
account authorization are required. Sign-in may enable account
model policies. Moguri is not an official Copilot partner.
Credentials stay in Moguri's profile-scoped OS keychain.`}</text></scrollbox> :
        mode === "command-results" ? <box flexGrow={1} flexDirection="column" paddingTop={1}>
          <text fg={colors.accent} height={2}>Original queued-command results</text>
          <text fg={colors.muted} height={3}>Latest 100 records for this session. Enter reads original input/result, never replays it. CLI commands list/read also inspects retained history.</text>
          <ThemedSelect focused flexGrow={1} options={(snapshot?.commandExecutions ?? []).filter((entry) => entry.sessionId === session?.id).slice(-100).reverse().map((entry) =>
            ({ name: safe(`/${entry.name} / ${entry.status}`), description: entry.id, value: entry.id }))} onSelect={(_, option) => {
            if (!option) return;
            void perform(async () => {
              const retained = await client.commands.read(String(option.value));
              show({ execution: retained.execution, input: retained.item, result: retained.result });
            });
          }} />
        </box> :
        mode === "trace" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Client request timings (transport, not server/model execution)</text><text fg={colors.muted}>{safe(JSON.stringify(client.getRequestTimings(), null, 2))}</text><text fg={colors.accent}>Recent events (last 200 received)</text>{events.filter((event) => !session || event.session_id === session.id).map((event) => <text key={event.id} fg={colors.muted}>{safe(`#${event.seq} ${event.event_type}\n${JSON.stringify(event.payload)}\n`)}</text>)}</scrollbox> :
        mode === "queue" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Held prompts do not run. /run ID releases one. /edit, /remove, /reorder and /copy ID manage prompts.</text>{session?.queue.map((item) => <text key={item.id} fg={colors.foreground}>{safe(`\n${item.id} [${item.held ? "held" : item.delivery}]\n${item.text}\n${item.attachments.map((attachment) => `${attachment.path} [${attachmentStatus(attachment)}] ${attachment.id}`).join("\n")}\n`)}</text>)}</scrollbox> :
          <scrollbox id="tui-transcript" ref={transcript} key={`conversation-${session?.id ?? "empty"}`} flexGrow={1} minHeight={0} stickyScroll={followTranscript} stickyStart="bottom">
            {!session?.messages.length && !session?.skillLoadSequence && <box flexDirection="column" paddingY={1} gap={1}>
              <text fg={colors.accent}><strong>What are we working on?</strong></text><text fg={colors.muted}>{session ? `${session.controls.modelId ? "Write a prompt to begin." : "Choose /models, then write a prompt."}\nTools follow this session's approval rules.` : "/new global starts a chat. /open PATH adds a project.\n/connect starts Copilot login. /help shows commands."}</text></box>}
            {!detailed && (session?.messages.length ?? 0) > 150 && <text fg={colors.muted}>Showing the latest 150 messages. F2 or /details reads the full retained conversation.</text>}
            {session?.messages.slice(detailed ? 0 : -150).map((message) => <TuiMessage key={`${message.id}:${detailed}`} message={message} detailed={detailed}
              activeTurnId={session.turnId} settledToolCalls={settledToolCalls} syntaxStyle={markdownStyle} renderMarkdownNode={renderMarkdownNode}
              inspect={() => setFollowTranscript(false)} snapshot={snapshot ?? undefined} />)}
            {session && snapshot && Boolean(session.skillLoadSequence) && <TuiSkillLoads sdk={client} session={session} snapshot={snapshot} />}
            {editor && <TuiPendingInput editor={editor} />}
            {snapshot?.scheduledPrompts.filter((prompt) => prompt.sessionId === session?.id && ["scheduled", "blocked"].includes(prompt.status)).map((prompt) =>
              <box key={prompt.id} flexDirection="column" border borderColor={colors.border} padding={1} marginTop={1}>
                <text fg={colors.muted}>{safe(`[clock] ${prompt.status === "blocked" ? "Paused" : "Scheduled"}, not sent / ${new Date(prompt.dueAt).toLocaleString()}\n${prompt.text}${prompt.diagnostic ? `\n${prompt.diagnostic}` : ""}\nF9 / Automations: Send now or Cancel`)}</text>
              </box>)}
            {commandResponses.map((response) => <box key={response.id} id={`tui-command-response-${response.id}`} flexDirection="column" paddingY={1}
              onMouseDown={(event) => { if (event.button !== 0 || modeRef.current !== "compose") return; event.preventDefault(); event.stopPropagation(); void perform(async () => { requireNavigation(); show(response.text); }); }}>
              <text fg={colors.accent}>{safe(`Command /${response.name} / ${response.id}`)}</text>
              <text fg={colors.muted}>Retained separately. Click to read, or /commands for keyboard history.</text>
            </box>)}
          </scrollbox>}
        {mode === "compose" && retry && <box id="tui-retry-model" border borderColor={colors.error} paddingX={1} flexShrink={0}
          onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); void perform(() => submit(editor?.getState().text ?? "")); }}>
          <text fg={colors.error}>{safe(`[X] Model request failed / ${retry.status}. [Retry] Enter or F10 retries the original request, not this draft.\n${retry.diagnostic}`)}</text>
        </box>}
        {mode === "compose" && session?.controls.modelId === "kupo" && <text fg={colors.muted} height={1} flexShrink={0}>{safe(`Kupo routing: ${kupoModes.find((mode) => mode.id === session.controls.kupoMode)?.name ?? "Legacy / choose a preference"} | F11 routing | Thinking: automatic | Context: dynamic / maximum per model`)}</text>}
        {mode === "compose" && continuedWork && <box flexDirection="column" border borderColor={colors.accent} padding={1} flexShrink={0}>
          <text fg={colors.accent}>{safe(`${continuedWork.source.title}: ${continuedWork.status} / one delegated task to its PR`)}</text>
          <text fg={colors.muted}>{safe(continuedWork.diagnostic ?? (continuedWork.prUrl ? `PR: ${continuedWork.prUrl}` : `Open its child in the sessions list, or inspect /kanban work ${continuedWork.id}.`))}</text>
        </box>}
        {snapshot?.provider.catalogue?.providers.filter((provider) => provider.account?.login).map((provider) => <box key={provider.id} flexDirection="column" border borderColor={colors.accent} padding={1}>
          <text fg={colors.accent}>{provider.name} sign-in</text><text fg={colors.foreground}>{provider.account!.login!.url}</text>
          <text fg={colors.muted}>Open this URL in your browser. If it cannot reach this machine, /login-code {provider.id} accepts the final redirect URL. /cancel-login {provider.id} cancels.</text>
        </box>)}
        {snapshot?.provider.login && <box flexDirection="column" border borderColor={colors.accent} padding={1}>
          <text fg={colors.accent}>GitHub Copilot sign-in: {snapshot.provider.login.code}</text><text fg={colors.foreground}>{snapshot.provider.login.url}</text><text fg={colors.muted}>Authorize in your browser. /cancel-login cancels. Account model policies may be enabled.</text>
        </box>}
        {snapshot?.provider.diagnostic && <text fg={colors.attention}>{safe(snapshot.provider.diagnostic)}</text>}
        {session?.pendingApproval && <box flexDirection="column" border borderColor={colors.attention} paddingX={1} paddingY={compact ? 0 : 1}
          height={compact ? mode === "approval" || mode === "approval-choices" ? 10 : 6 : mode === "approval-choices" ? 17 : 10} flexShrink={0}>
          <text fg={colors.attention} height={1} wrapMode="none" truncate><strong>Approval required: {session.pendingApproval.call.harness ? `${agentHarnessProduct(session.pendingApproval.call.harness)} ${session.pendingApproval.call.name}` : session.pendingApproval.call.name}</strong></text>
          {mode === "approval-choices" ? <ThemedSelect focused flexGrow={1} options={[
            { name: "Approve only this action", description: "No remembered grant.", value: "once" },
            ...(session.pendingApproval.call.name === "run_script" || session.pendingApproval.call.harness ? [] : [
            { name: "Approve for this session", description: "Same exact command/arguments or MCP tool.", value: "session:exact" },
            ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: "Approve for this project", description: "All sessions of the selected repository, current environment.", value: "project:exact" }] : []),
            { name: "Always approve across this profile", description: "Same exact command/arguments or schema-bound MCP tool.", value: "global:exact" },
            ...(!["run_command", "run_script", "command_job", "debug", "mcp_gateway"].includes(session.pendingApproval.call.name) ? [
              { name: `Always approve ${session.pendingApproval.call.name} for this session`, description: "New arguments, same actual session and environment.", value: "session:tool" },
              ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: `Always approve ${session.pendingApproval.call.name} for this project`, description: "New arguments in the selected repository; hard restrictions still apply.", value: "project:tool" }] : []),
              { name: `Always approve ${session.pendingApproval.call.name} globally`, description: "Current profile and environment; not a command or MCP wildcard.", value: "global:tool" },
            ] : []),
            ]),
            ...(!session.pendingApproval.call.harness && (session.pendingApproval.call.name === "run_command" || session.pendingApproval.call.name === "command_job" && session.pendingApproval.call.arguments.action === "start") &&
              typeof session.pendingApproval.call.arguments.command === "string" && commandFamily(session.pendingApproval.call.arguments.command) ? [
                ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: `Always approve ${commandFamily(session.pendingApproval.call.arguments.command)} for this project`, description: "Any simple command arguments in this repository; compound expressions still ask.", value: "project:family" }] : []),
                { name: `This family of commands: ${commandFamily(session.pendingApproval.call.arguments.command)}`, description: "Across this profile in the current environment. Compound expressions still ask; hard denials still win.", value: "global:family" },
              ] : []),
          ]} onSelect={(_, option) => {
            if (!option || !session.pendingApproval) return;
            const [scope, match] = String(option.value).split(":");
            void perform(async () => { await client.approvals.respond(session.id, session.pendingApproval!.id, true, scope === "once" ? undefined : parse(RememberApprovalSchema, { scope, match })); setMode("compose"); });
          }} /> : <scrollbox flexGrow={1} focused={mode === "approval"}><text fg={colors.foreground}>{safe(`${approvalSubject}${JSON.stringify(session.pendingApproval.call.arguments, null, 2)}${approvalAdvice ? `\n\nModel advice (not approval): ${approvalAdvice}` : session.controls.autonomy === "Guided" ? "\n\nThe current solver supplied no explicit recommendation. You must decide." : ""}`)}</text></scrollbox>}
          <text fg={colors.attention} height={2} flexShrink={0}>{session.pendingApproval.call.name === "run_script" ? session.controls.env === "Sandbox" ? "Reviewed bytes / SendBox guest, not Local. Advice is not permission. " : "Exact reviewed bytes, unsandboxed Local. Agent advice is not permission. " : session.pendingApproval.call.name === "run_command" ? session.controls.env === "Remote" ? "SSH host, not SendBox. " : session.controls.env === "Sandbox" ? "Approved SendBox boundary. " : "Unsandboxed Local. " : session.pendingApproval.call.name === "fetch_page" ? "Approved Sandbox network hosts. " : "Project access. "}{compact ? "\nCtrl+Y approve | Ctrl+D deny | Ctrl+V args" : "\n/approve once | Ctrl+D deny | Ctrl+V args | Ctrl+Y approve"}</text>
        </box>}
        {pendingQuestion && mode !== "question" && <box flexDirection="column" border borderColor={colors.attention} paddingX={1} paddingY={compact ? 0 : 1} height={compact ? 6 : recommendation ? 11 : 9} flexShrink={0}>
          <text fg={colors.attention} height={1} wrapMode="none" truncate flexShrink={0}><strong>Your actual answer is needed / F6 choices</strong></text>
          <text fg={colors.foreground} height={2} truncate flexShrink={0}>{safe(pendingQuestion.question).slice(0, 320)}</text>
          {recommendation && !compact && <text fg={colors.muted} height={2} flexShrink={0}>Model advises: {safe(recommendation.choice)}. F6 shows its reason; no answer was recorded.</text>}
          <text fg={colors.muted} height={compact ? 1 : 2} wrapMode={compact ? "none" : "word"} truncate flexShrink={0}>{compact ? "Enter answers | Cmd/Ctrl+Enter holds" : "Enter answers; Shift+Enter inserts a newline. Cmd/Ctrl+Enter still queues. No tool permission is granted."}</text>
        </box>}
        {mode === "compose" && repositoryPrompt && <box id="tui-repository-proposal" height={1} flexShrink={0}
          onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); setMode("repository-import"); }}>
          <text fg={colors.attention} height={1} wrapMode="none" truncate>{safe(`[F12] This chat wrote code in ${repositoryPrompt.root}. Import it as a project and move this chat?`)}</text>
        </box>}
        {session?.localFinishing && <text fg={colors.attention}>Local finishing: new Local turns are blocked by policy.</text>}
        {notice || error ? <TerminalAlert key={`${client.profileId}:${selectedId}:${notice?.id ?? error}`} text={notice?.text || error || ""}
          error={notice?.error ?? Boolean(error)} keyboard={mode === "compose" && !navigationFocus && !sidebarOnly} /> : null}
        {snapshot?.jobs.filter((job) => job.status === "running" && (!job.sessionId || job.sessionId === session?.id)).slice(-2).map((job) => <text key={job.id} fg={colors.accent}>{safe(`${job.kind}: ${job.progress} (${job.id})`)}</text>)}
        {latestTranscript && <text fg={colors.accent}>Local transcript ready. F4 inserts it into the draft; it is never sent automatically.</text>}
        {mode === "compose" && session && editor && <TuiComposer key={session.id} editor={editor} session={session} focused={!navigationFocus && !sidebarOnly} compact={compact}
          focus={() => setNavigationFocus(false)} submit={() => void perform(() => submit(editor.getState().text))} run={perform} />}
        {mode === "compose" && !session && <box border borderStyle="double" borderColor={colors.accent} paddingX={1} flexShrink={0} title="Commands">
          <ThemedInput id="tui-startup-command" focused value={startupCommand} placeholder="/new global  /open PATH  /connect  /help" onInput={setStartupCommand} onSubmit={(text) => void perform(() => submit(text))} />
        </box>}
        <box id="tui-status" flexShrink={0} flexDirection="column" backgroundColor={colors.background}>
          <box height={inlineControls ? 1 : 2} flexDirection={inlineControls ? "row" : "column"} flexShrink={0}>
            <text id="tui-status-env" width={inlineControls ? "50%" : "100%"} height={1} wrapMode="none" truncate fg={colors.muted}>{session ? `Env ${session.controls.env} | Model ${safe(session.controls.modelId ?? "not set (/models)")}` : "Env Local | Model not set"}</text>
            <text id="tui-status-budget" width={inlineControls ? "50%" : "100%"} height={1} wrapMode="none" truncate fg={colors.muted}>{`Autonomy level ${session?.controls.autonomy ?? "Manual"} | Budget ${session?.controls.budget.kind === "limited" ? "estimated cap" : "Unlimited"}${snapshot?.budgetPolicy.limit ? " / profile cap" : ""}`}</text>
          </box>
          {sessionStateVisible && <text height={1} wrapMode="none" truncate fg={sessionStatusLabel(session.status).tone === "failed" ? colors.error :
            ["attention", "partial", "unknown"].includes(sessionStatusLabel(session.status).tone) || session.toolRecovery?.turnId === session.turnId ? colors.attention : colors.muted}>{`${session.toolRecovery?.turnId === session.turnId ? "Read-only recovery" : session.pendingMode ? `${sessionModeLabel(session.pendingMode)} pending` : sessionModeLabel(session.mode)} | ${snapshot?.managedWorkspaces.some((workspace) => workspace.id === session.workspaceId && workspace.status === "creating") ? "Preparing worktree" : sessionStatusLabel(session.status).label}${session.queue.length ? ` | ${session.queue.length} queued` : ""}${session.kind === "side" ? " | main context per question" : ""}`}</text>}
          {planVisible && <text height={1} wrapMode="none" truncate fg={taskProgress.error ? colors.attention : colors.muted}>{safe(`Plan ${progressBar(taskProgress.progress?.checklist.percent ?? null, 8)} / ${taskProgress.error ? "unavailable, /progress" : `${taskProgress.progress?.checklist.completed}/${taskProgress.progress?.checklist.total}`} / estimate, 15s`)}</text>}
          {estimateVisible && <text height={1} wrapMode="none" truncate fg={colors.attention}>{safe(`Model estimate ${progressBar(estimateVisible.percent, 8)}${estimateVisible.stale ? " (stale)" : ""}${taskProgress.progress?.disagreement ? " / differs from plan" : ""} /progress for details`)}</text>}
        </box>
      </box>
    </box>
    <box id="tui-footer" height={navigationFocus && width < 80 ? 2 : 1} paddingLeft={1} flexShrink={0} flexDirection="row">
      {!navigationFocus && !followTranscript && <box id="tui-follow-output" width={12} height={1} onMouseDown={(event) => {
        if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); followLatest();
      }}><text fg={colors.accent}>F3 latest |</text></box>}
      <text fg={colors.muted}>{navigationFocus ? "Left/Right sidebar | Up/Down tabs | Enter choose | Tab/Esc back" :
        !followTranscript ? "PgUp/PgDn | F2 details | /help commands" : compact ? "/help commands | F2 details | Tab navigate" :
        "Enter send | Shift+Enter newline | Cmd/Ctrl+Enter hold | F2 details | Tab navigation | /help commands"}</text>
    </box>
  </box></NavigationContext.Provider></ThemeContext.Provider>;
}
export function TuiMessage({ message, detailed, activeTurnId, settledToolCalls, syntaxStyle, renderMarkdownNode, inspect, snapshot = NO_REGISTRY }: {
  message: PublicMessage; detailed: boolean; activeTurnId: string | null; settledToolCalls: ReadonlySet<string>;
  syntaxStyle: SyntaxStyle; renderMarkdownNode: NonNullable<MarkdownOptions["renderNode"]>; inspect: () => void; snapshot?: Pick<Snapshot, "registry">;
}) {
  const colors = React.useContext(ThemeContext), [expanded, setExpanded] = useState(false);
  const documents = message.attachments?.filter((attachment) => attachment.kind === "document").map((attachment) =>
    <text key={attachment.id} fg={colors.accent}>{safe(`${attachment.path} [${attachmentStatus(attachment)}] ${attachment.id}`)}</text>);
  if (message.role === "tool") {
    const call = message.toolCalls?.[0], important = message.outcome !== "completed", open = detailed || expanded || important;
    const described = call ? describeActivityCall(call, snapshot) : null;
    const value = described?.subject ?? (call && [call.arguments.path, call.arguments.query, call.arguments.pattern].find((value): value is string => typeof value === "string"));
    const summary = value ? safe(value.split("\n")[0]!) : `${Buffer.byteLength(message.text, "utf8")} bytes`;
    return <box flexDirection="column" marginTop={important ? 1 : 0} flexShrink={0}>
      <box id={`tui-tool-${message.id}`} height={1} onMouseDown={(event) => {
        if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); inspect(); setExpanded((value) => !value);
      }}><text height={1} wrapMode="none" truncate fg={important ? colors.attention : colors.muted}>
        {safe(`${open ? "v" : ">"} ${described?.label ?? "Tool"} / ${message.errorCode === "not_found" ? "Not Found" : outcomeLabel(message.outcome).label}  ${summary}${open ? "" : "  F2 details"}`)}
      </text></box>
      {open && <text fg={important ? colors.attention : colors.muted}>{safe(message.text || "No text output.")}</text>}
      {documents}
    </box>;
  }
  const request = message.role === "assistant" && !message.text && Boolean(message.toolCalls?.length);
  if (request && !detailed && (!message.outcome || ["stop", "toolUse"].includes(message.outcome))) {
    const pending = message.toolCalls?.filter((call) => !settledToolCalls.has(call.id)) ?? [];
    if (!pending.length && !documents?.length) return null;
    return <box flexDirection="column" flexShrink={0}>
      {pending.length > 0 && <text fg={colors.muted}>{safe(`${pending.map((call) => describeActivityCall(call, snapshot).label).join(", ")} / ${outcomeLabel("pending").label}`)}</text>}
      {documents}
    </box>;
  }
  const outcome = message.outcome && (message.role === "notice" || !["stop", "toolUse"].includes(message.outcome)) ? ` / ${outcomeLabel(message.outcome).label}` : "";
  const frame: Pick<BoxOptions, "border" | "borderColor"> = message.role === "user" ? { border: ["left"], borderColor: colors.accent } : {};
  // Notices follow the shared tone: failures read as errors, stopped or completed notices stay neutral, the rest need attention.
  const tone = outcomeLabel(message.outcome).tone;
  const noticeColor = tone === "failed" ? colors.error : ["completed", "stopped", "neutral"].includes(tone) ? colors.foreground : colors.attention;
  return <box flexDirection="column" marginTop={1} paddingLeft={message.role === "user" ? 1 : 0} {...frame} flexShrink={0}>
    <text height={1} fg={message.role === "user" ? colors.accent : message.role === "notice" ? noticeColor : colors.muted}>
      <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Moguri" : "Session"}</strong>{safe(outcome)}
    </text>
    {message.role === "assistant" && message.text ? <markdown id={`tui-prose-${message.id}`} width="100%" internalBlockMode="top-level" content={safe(message.text)} syntaxStyle={syntaxStyle} fg={colors.foreground}
      conceal streaming={!message.outcome && activeTurnId === message.turnId} renderNode={renderMarkdownNode}
      tableOptions={{ style: "columns", borders: false, cellPaddingY: 0 }} /> : <text fg={message.role === "notice" ? noticeColor : colors.foreground}>{safe(message.text || "No text output.")}</text>}
    {detailed && message.toolCalls?.length ? <text fg={colors.muted}>{safe(JSON.stringify(message.toolCalls, null, 2))}</text> : null}
    {detailed && message.reasoning && <text fg={colors.muted}>{safe(`Provider-exposed reasoning:\n${message.reasoning}`)}</text>}
    {documents}
  </box>;
}
export function TuiSkillLoads({ sdk, session, snapshot }: { sdk: MoguriSdk; session: Session; snapshot: Snapshot }) {
  const colors = React.useContext(ThemeContext), activity = useSessionActivity(sdk, session, snapshot);
  const loaded = activity.activity?.entries.filter((entry) => entry.kind === "load-skill" && entry.status === "completed" &&
    (entry.source === "skill" || entry.label === "Loaded skill")) ?? [];
  return <box flexDirection="column" flexShrink={0} marginTop={loaded.length ? 1 : 0}>
    {loaded.map((entry) => <text key={entry.id} id={`tui-skill-${entry.id}`} fg={colors.accent}>{safe(`📖 ${entry.label}: ${entry.subject ?? "Original skill"}`)}</text>)}
    {activity.error && <text fg={colors.error}>{safe(activity.error)}</text>}
    {activity.activity?.nextBefore && <text fg={colors.muted}>Earlier original activity remains available through /activity.</text>}
  </box>;
}
function TuiScheduleDialog({ sdk, editor, initial, lock, close }: { sdk: MoguriSdk; editor: DraftEditor; initial: "ask" | "schedule"; lock: (pending: boolean) => void; close: () => void }) {
  const colors = React.useContext(ThemeContext);
  const [phase, setPhase] = useState<"ask" | "schedule" | "custom" | "occurrence">(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const [original] = useState(() => ({ profileId: sdk.profileId, text: editor.getState().text, attachments: JSON.stringify(editor.getState().attachments) }));
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [local, setLocal] = useState(() => scheduleLocalTime(Date.now() + 30 * 60_000, zone).localTime);
  const [choices, setChoices] = useState<Array<Extract<ScheduledTiming, { kind: "at" }>>>([]);
  const act = async (choice: "send" | "schedule", remember = false, timing?: ScheduledTiming) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); lock(true); setError("");
    try {
      if (sdk.profileId !== original.profileId || editor.getState().text !== original.text || JSON.stringify(editor.getState().attachments) !== original.attachments) throw new Error("The original draft changed. Esc and review the current draft; newer text was preserved.");
      if (remember) {
        const current = sdk.settings.get();
        if (!current) throw new Error("Reconnect this profile before remembering the choice.");
        await sdk.settings.update({ ...current.values, interactions: { ...current.values.interactions, idleScheduleAction: choice } }, current.revision);
      }
      if (choice === "send") { await editor.send("queue", false); close(); }
      else if (!timing) setPhase("schedule");
      else { await editor.submit((revision) => sdk.scheduledPrompts.create(editor.sessionId, timing, revision)); close(); }
    } catch (error) { setError(error instanceof Error ? error.message : "The original scheduled prompt was not acknowledged. Draft preserved."); }
    finally { pending.current = false; setBusy(false); lock(false); }
  };
  return <box flexDirection="column" flexGrow={1} padding={1}>
    <text fg={colors.accent} height={2}>{phase === "ask" ? "Nothing is running. Send now instead of scheduling?" : `Schedule prompt / local timezone ${zone}`}</text>
    <text fg={colors.muted} height={3}>Original prompt stays unsent. Esc cancels. Current controls, permissions and budgets still apply.</text>
    {error && <text fg={colors.error} height={4}>{safe(error)}</text>}
    {busy ? <text fg={colors.attention}>Saving the original choice. No replacement request will be sent.</text> :
      phase === "ask" ? <ThemedSelect focused flexGrow={1} options={[
        { name: "Send now", value: "send", description: "Use the normal prompt intake" },
        { name: "No, schedule", value: "schedule", description: "Choose a delay or exact local date/time" },
        { name: "Send now; don't ask again", value: "send:remember", description: "Remember Send now in this profile" },
        { name: "Schedule; don't ask again", value: "schedule:remember", description: "Always open scheduling for idle Hold" },
      ]} onSelect={(_, option) => { if (!option) return; const [choice, memory] = String(option.value).split(":"); if (choice === "send" || choice === "schedule") void act(choice, memory === "remember"); }} /> :
      phase === "schedule" ? <ThemedSelect focused flexGrow={1} options={[...[5, 10, 30, 60].map((minutes) => ({ name: `${minutes} minutes`, value: String(minutes), description: "Send once after this delay, including after restart" })),
        { name: "Custom local date and time", value: "custom", description: "Review the exact timezone and UTC occurrence" }]}
        onSelect={(_, option) => { if (!option) return; if (option.value === "custom") setPhase("custom"); else void act("schedule", false, { kind: "delay", minutes: Number(option.value), timeZone: zone }); }} /> :
      phase === "custom" ? <><text fg={colors.muted} height={2}>Local date/time: YYYY-MM-DDTHH:mm. Enter reviews its exact UTC occurrence.</text>
        <ThemedInput focused value={local} onInput={setLocal} onSubmit={(text) => {
          try { setChoices(scheduleLocalChoices(text, zone)); setPhase("occurrence"); setError(""); }
          catch (error) { setError(error instanceof Error ? error.message : "Choose a valid local date and time."); }
        }} /></> :
      <ThemedSelect focused flexGrow={1} options={choices.map((timing, index) => ({ name: `${timing.localTime} / UTC offset ${timing.offsetMinutes} minutes${choices.length > 1 ? ` / occurrence ${index + 1}` : ""}`, value: timing.at, description: `${zone}; actual instant ${timing.at}` }))}
        onSelect={(_, option) => { const timing = choices.find((timing) => timing.at === option?.value); if (timing) void act("schedule", false, timing); }} />}
  </box>;
}
function TuiScheduledPrompts({ sdk, prompts, run }: { sdk: MoguriSdk; prompts: ScheduledPrompt[]; run: (operation: () => Promise<unknown>) => Promise<void> }) {
  const colors = React.useContext(ThemeContext), [busy, setBusy] = useState(false), pending = useRef(false);
  const entries = prompts.filter((prompt) => ["scheduled", "blocked", "queued"].includes(prompt.status));
  return <box flexDirection="column" flexGrow={1} padding={1}><text fg={colors.accent} height={2}>Automations / Scheduled prompts</text>
    <text fg={colors.muted}>Automations cover actions, not just prompts. Currently: one-time prompts only; other actions unavailable.</text>
    <text fg={colors.muted} height={3}>One-time unsent prompts in this profile. Enter sends/cancels the exact input. Your current composer is not consumed.</text>
    {!entries.length ? <text fg={colors.muted}>No scheduled prompts. Cmd/Ctrl+Enter in an idle chat opens scheduling.</text> :
      <ThemedSelect focused={!busy} flexGrow={1} options={entries.flatMap((prompt) => [
        { name: `Send now / ${safe(prompt.text.split("\n")[0]!.slice(0, 60))}`, value: `send:${prompt.id}`, description: `${new Date(prompt.dueAt).toLocaleString()} / ${prompt.status} / ${prompt.id}` },
        { name: `Cancel / ${safe(prompt.text.split("\n")[0]!.slice(0, 60))}`, value: `cancel:${prompt.id}`, description: prompt.diagnostic ?? "Cancel before admission; never stop another turn" },
      ])} onSelect={(_, option) => { if (!option || pending.current) return; const [action, id] = String(option.value).split(":"), prompt = entries.find((entry) => entry.id === id); if (!prompt) return;
        pending.current = true; setBusy(true); void run(async () => { try { if (action === "send") await sdk.scheduledPrompts.sendNow(prompt.id, prompt.revision); else await sdk.scheduledPrompts.cancel(prompt.id, prompt.revision); } finally { pending.current = false; setBusy(false); } });
      }} />}
  </box>;
}
function TuiPendingInput({ editor }: { editor: DraftEditor }) {
  const colors = React.useContext(ThemeContext);
  const input = useSyncExternalStore(editor.subscribe, () => editor.getState().pendingInput, () => editor.getState().pendingInput);
  if (!input) return null;
  return <box id="tui-pending-input" flexDirection="column" border borderColor={colors.border} padding={1}>
    <text fg={colors.accent}>{pendingInputStatus(input)} Awaiting service acknowledgement.</text>
    <text fg={colors.foreground}>{safe(input.text)}</text>
    {input.attachments.length > 0 && <text fg={colors.muted}>{safe(input.attachments.map((attachment) => attachment.path).join("\n"))}</text>}
  </box>;
}
function TuiComposer({ editor, session, focused, compact, focus, submit, run }: { editor: DraftEditor; session: Session; focused: boolean; compact: boolean; focus: () => void; submit: () => void; run: (operation: () => Promise<void>) => Promise<void> }) {
  const colors = React.useContext(ThemeContext);
  const draft = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);
  const limitedSuggestions = compact && Boolean(session.pendingApproval || session.pendingQuestionId);
  const [suggestionIndex, renderSuggestionIndex] = useState(0), suggestions = tuiCommandSuggestions(draft.text).slice(0, limitedSuggestions ? 1 : compact ? 3 : 6);
  const suggestionIndexRef = useRef(0);
  const setSuggestionIndex = (value: number) => { suggestionIndexRef.current = value; renderSuggestionIndex(value); };
  useEffect(() => { setSuggestionIndex(0); }, [draft.text]);
  const complete = (index: number) => {
    const suggestion = suggestions[index];
    if (suggestion) editor.edit(`/${suggestion.name} `);
  };
  useKeyboard((key) => {
    if (!focused || !suggestions.length || key.ctrl || key.meta || key.super) return;
    if (key.name === "tab" || key.name === "up" || key.name === "down") {
      key.preventDefault(); key.stopPropagation();
      if (key.name === "tab") complete(suggestionIndexRef.current);
      else setSuggestionIndex((suggestionIndexRef.current + (key.name === "up" ? -1 : 1) + suggestions.length) % suggestions.length);
    }
  });
  const ref = useRef<TextareaRenderable>(null);
  const mirror = useRef<{ setting: boolean; text: string | null }>({ setting: false, text: null });
  useEffect(() => {
    if (ref.current && ref.current.plainText !== draft.text) {
      mirror.current.setting = true;
      try { ref.current.setText(draft.text); mirror.current.text = ref.current.plainText; }
      finally { mirror.current.setting = false; }
    }
  }, [draft.text]);
  return <box id="tui-composer-panel" flexDirection="column" border={["left"]} borderColor={focused ? colors.accent : colors.border} backgroundColor={colors.surface} paddingX={1} marginTop={1} overflow="hidden" flexShrink={0}>
    {/^\/budget\s+(?:set|profile|global)\b/.test(draft.text) && <text fg={colors.attention} height={3} flexShrink={0}>{BUDGET_WARNING} Input reservations use an explicit estimate-based policy, not a billing guarantee.</text>}
    <textarea id="tui-composer" ref={ref} focused={focused} initialValue={draft.text} height="auto" minHeight={limitedSuggestions ? 1 : 2} maxHeight={limitedSuggestions ? 2 : 8} textColor={colors.foreground} backgroundColor={colors.surface}
      onMouseDown={focus}
      placeholder={session.status === "archived" ? "Archived. /restore returns to this session." : "Write a prompt..."}
      keyBindings={[{ name: "return", action: "submit" }, { name: "return", shift: true, action: "newline" },
        { name: "kpenter", action: "submit" }, { name: "kpenter", shift: true, action: "newline" },
        { name: "j", ctrl: true, action: "newline" },
        { name: "return", ctrl: true, shift: true, action: "submit" }]} onSubmit={() => {
          const text = ref.current?.plainText;
          if (text === undefined) throw new Error("The original composer is no longer mounted. No input was sent.");
          if (text !== editor.getState().text) editor.edit(text);
          submit();
        }}
      onPaste={(event) => {
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(event.bytes); }
        catch {
          event.preventDefault(); event.stopPropagation();
          void run(async () => { throw new Error("Terminal paste is not valid UTF-8. Nothing was captured, replaced or sent; choose a valid text source."); });
          return;
        }
        const input = ref.current;
        if (pasteLineCount(text) <= 50 || !input) return;
        event.preventDefault(); event.stopPropagation();
        const selected = input.getSelection(), start = selected?.start ?? input.cursorOffset, end = selected?.end ?? start;
        const before = input.editBuffer.getTextRange(0, Math.min(start, end)).length, after = input.editBuffer.getTextRange(0, Math.max(start, end)).length;
        void run(() => editor.paste(text, before, after));
      }}
      onContentChange={() => {
        const text = ref.current?.plainText ?? "";
        if (mirror.current.setting || text === mirror.current.text) return;
        mirror.current.text = null;
        if (text !== editor.getState().text) editor.edit(text);
      }} />
    {draft.attachments.length > 0 && <text fg={colors.accent}>{safe(draft.attachments.map((attachment) => `@${attachment.path}${attachment.kind === "document" ? ` [${attachmentStatus(attachment)}] ${attachment.id}` : ""}`).join("  "))}</text>}
    <text fg={draft.error ? colors.error : colors.muted}>{draft.error ?? (draft.saving ? "Saving draft..." : draft.dirty ? "Unsent edits" : "Draft saved")}</text>
    {focused && suggestions.length > 0 && <box id="tui-slash-suggestions" flexDirection="column" border={limitedSuggestions ? false : ["top"]} borderColor={colors.border}>
      {!limitedSuggestions && <text fg={colors.muted}>Commands / Up/Down choose / Tab or click fills / Enter runs</text>}
      {suggestions.map((entry, index) => <box id={`tui-command-${entry.name}`} key={entry.name} height={1}
        backgroundColor={index === suggestionIndex ? colors.panel : colors.surface}
        onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); complete(index); }}>
        <text height={1} wrapMode="none" truncate fg={index === suggestionIndex ? colors.selection : colors.foreground}>{index === suggestionIndex ? "> " : "  "}/{entry.name}  {entry.description}</text>
      </box>)}
    </box>}
  </box>;
}
function ThemedSelect(props: SelectProps) {
  const colors = React.useContext(ThemeContext), navigation = React.useContext(NavigationContext);
  return <select {...props} focused={props.focused && !navigation} backgroundColor={colors.surface} textColor={colors.foreground}
    focusedBackgroundColor={colors.surface} focusedTextColor={colors.foreground} descriptionColor={colors.muted}
    selectedBackgroundColor={colors.panel} selectedTextColor={colors.selection} selectedDescriptionColor={colors.selection} />;
}
function ThemedInput({ onSubmit, ...props }: Omit<InputProps, "onSubmit" | "ref"> & { onSubmit?: (text: string) => void }) {
  const colors = React.useContext(ThemeContext), navigation = React.useContext(NavigationContext);
  const ref = useRef<InputRenderable>(null);
  return <input {...props} ref={ref} focused={props.focused && !navigation} textColor={colors.foreground} backgroundColor={colors.surface}
    onSubmit={() => { if (!ref.current) throw new Error("The terminal input is no longer mounted. Nothing was submitted."); onSubmit?.(ref.current.plainText); }}
    focusedTextColor={colors.foreground} focusedBackgroundColor={colors.surface} placeholderColor={colors.muted} />;
}
function SettingsTextEditor({ value, change, submit }: { value: string; change: (value: string) => void; submit: (value: string) => void }) {
  const colors = React.useContext(ThemeContext);
  const ref = useRef<TextareaRenderable>(null);
  return <box flexGrow={1} minHeight={0} border borderColor={colors.border} padding={1}>
    <textarea ref={ref} initialValue={value} focused flexGrow={1} textColor={colors.foreground} backgroundColor={colors.background}
      keyBindings={[{ name: "return", ctrl: true, action: "submit" }]} onSubmit={() => submit(ref.current?.plainText ?? value)}
      onContentChange={() => { const text = ref.current?.plainText ?? ""; if (text !== value) change(text); }} />
  </box>;
}
