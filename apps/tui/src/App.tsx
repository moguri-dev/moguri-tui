/** @jsxImportSource @opentui/react */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { stripVTControlCharacters } from "node:util";
import { useMoguri, useTaskProgress } from "../../../packages/sdk/src/react.ts";
import { attachmentStatus, compareSessions, progressBar } from "../../../packages/sdk/src/index.ts";
import { approvalProject, commandFamily, RememberApprovalSchema, type GithubItem, type GithubRepository, type GithubResponse, type GithubScope } from "../../../packages/sdk/src/index.ts";
import { continueWorkInput, DraftEditor, MOGURI_ASCII, parse, parseSlash, pasteLineCount, parseAttachmentTrigger, attachmentTriggers, isSharedSlash, slashCommands, SettingsSchema, ProjectSettingsSchema, SYSTEM_PROMPT_WARNING, BUDGET_WARNING, ProfileDraftSchema, defaultBoard, IssueInputSchema, BoardConfigSchema, ArtifactDraftSchema, ArtifactChangesSchema, isRecord, type ContinueWorkReview, type PlanEditorRequest, type ArtifactEditorRequest, type ArtifactExport, type MoguriSdk, type Command, type Controls, type Session, type SettingsSection, type SlashResult, type Profile, type ProfileCatalog } from "../../../packages/sdk/src/index.ts";
type MoguriClient = MoguriSdk;

const colors = { background: "#172027", panel: "#1e2a32", foreground: "#dce4e8", muted: "#a1b0ba", accent: "#99c4ae", border: "#40515d", error: "#f0b3a7", attention: "#e8c785" };
const safe = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const label = (session: Session) => session.messages.find((message) => message.role === "user")?.text.split("\n")[0]?.slice(0, 44) || session.title;
type Mode = "compose" | "project" | "sessions" | "models" | "queue" | "trace" | "help" | "approval" | "approval-choices" | "github-repositories" | "github-clone" | "github-items" | "github-detail" | "settings" | "prompt-editor" | "settings-editor" | "project-editor" | "capability-output" | "mcp-token" | "issues" | "work-items" | "issue-editor" | "board-editor" | "artifacts" | "artifact-editor" | "question" | "profiles" | "profile-editor" | "profile-recovery" | "plan-editor" | "continue-work";
const editorModes: Mode[] = ["prompt-editor", "settings-editor", "project-editor", "issue-editor", "board-editor", "artifact-editor", "profile-editor", "plan-editor"];
export interface TuiNativeActions { browser: (url: string) => Promise<void>; file: (path: string) => Promise<void>; copy: (text: string) => Promise<void>; saveExport?: (path: string, document: ArtifactExport) => Promise<{ path: string; digest: string }> }

export function TuiApp({ client: initialClient, onQuit, initialSessionId, native }: { client: MoguriClient; onQuit?: () => void; initialSessionId?: string; native?: TuiNativeActions }) {
  const [client, setClient] = useState(initialClient);
  const clients = useRef(new Set([initialClient]));
  const { snapshot, status, error, events } = useMoguri(client);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [mode, setMode] = useState<Mode>("compose");
  const [notice, setNotice] = useState("");
  const [skillHelp, setSkillHelp] = useState<{ profileId: string; text: string } | null>(null);
  const [continueReview, setContinueReview] = useState<ContinueWorkReview | null>(null);
  const [otherQuestion, setOtherQuestion] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [settingsText, setSettingsText] = useState("");
  const settingsRevision = useRef(0);
  const [capabilityOutput, setCapabilityOutput] = useState("");
  const [githubRepositories, setGithubRepositories] = useState<Extract<GithubResponse, { type: "github.repositories" }> | null>(null);
  const [githubRepository, setGithubRepository] = useState<GithubRepository | null>(null), [githubCloneJob, setGithubCloneJob] = useState<string | null>(null);
  const [githubItems, setGithubItems] = useState<{ scope: GithubScope; context: Extract<GithubResponse, { type: "github.project" }>; kind: "issue" | "pull"; items: GithubItem[]; nextPage: number | null } | null>(null);
  const [githubSelection, setGithubSelection] = useState<(Extract<GithubResponse, { type: "github.source" }> & { scope: GithubScope }) | null>(null);
  const [githubBusy, setGithubBusy] = useState(false), githubPending = useRef(false);
  const githubSearch = useRef({ source: "account" as "account" | "public", query: "" });
  const githubOwner = useRef("");
  const [tokenServer, setTokenServer] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [tokenKind, setTokenKind] = useState<"mcp" | "linear" | "model" | "remote-model" | "cache">("mcp");
  const issueEditor = useRef<{ id: string | null; revision: number }>({ id: null, revision: 0 });
  const artifactEditor = useRef<ArtifactEditorRequest | null>(null);
  const planEditor = useRef<PlanEditorRequest | null>(null), planSaving = useRef(false);
  const [planPending, setPlanPending] = useState(false);
  const documentCapture = useRef<{ sessionId: string; id: string } | null>(null);
  const [profiles, setProfiles] = useState<ProfileCatalog | null>(null);
  const profileEditor = useRef<Profile | null>(null);
  const switchingProfile = useRef(false);
  const [profilePending, setProfilePending] = useState(false);
  const editors = useRef(new Map<string, DraftEditor>());
  useEffect(() => () => { for (const editor of editors.current.values()) editor.dispose(); for (const client of clients.current) client.disconnect(); }, []);
  const session = snapshot?.sessions.find((session) => session.id === selectedId);
  githubOwner.current = JSON.stringify([client.profileId, session?.id, session?.projectId, session?.workspaceId, session?.controls.env]);
  const taskProgress = useTaskProgress(client, session, status === "connected");
  const project = snapshot?.projects.find((project) => project.id === session?.projectId);
  const pendingQuestion = snapshot?.questions.find((question) => question.id === session?.pendingQuestionId && question.status === "open");
  useEffect(() => { setOtherQuestion(null); }, [client.profileId, pendingQuestion?.id, pendingQuestion?.revision]);
  const recommendation = pendingQuestion?.recommendation;
  const questionDetails = pendingQuestion ? `${pendingQuestion.question}${recommendation ? `\n\nModel recommends: ${recommendation.choice}\n${recommendation.reason}\nFrom ${recommendation.modelId}. Untrusted advice; you still decide.` : ""}` : "";
  const approvalAdvice = session?.pendingApproval?.recommendationSource?.stepId === session?.pendingApproval?.stepId && session?.pendingApproval?.recommendationSource?.callId === session?.pendingApproval?.call.id ? session?.pendingApproval?.recommendation : undefined;
  const availableModels = snapshot?.provider.models.filter((model) => model.synthetic || !model.environments || model.environments.includes(session?.controls.env ?? "Local")) ?? [];
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
  const perform = async (action: () => Promise<unknown>) => {
    setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Operation failed. The draft is preserved."); }
  };
  const command = (command: Command) => perform(() => client.command(command));
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
  const chooseSession = async (id: string) => { if (editorModes.includes(mode)) throw new Error("Save or discard the local editor before selecting another session."); await editor?.flush(); setSelectedId(id); setMode("compose"); if (snapshot?.sessions.find((session) => session.id === id)?.unread) await client.sessions.organize(id, { unread: false }); const ids = client.getState().snapshot?.attention.filter((entry) => entry.sessionId === id && !entry.acknowledged).map((entry) => entry.id) ?? []; if (ids.length) await client.attention.acknowledge(ids.slice(-100)); };
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
      setSelectedId(null); setMode("compose"); setTokenValue(""); setTokenServer(""); setSettingsText(""); setCapabilityOutput(""); setNotice("");
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
  const configure = (controls: Controls, rememberModelSelection = false) => {
    if (!session) throw new Error("Create a session first.");
    return client.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls,
      ...(rememberModelSelection ? { rememberModelSelection: true } : {}) });
  };
  const requiredProject = () => { if (!session?.projectId) throw new Error("This operation needs a selected project. Use Ctrl+O or open a project chat."); return session.projectId; };
  const show = (value: unknown) => { setCapabilityOutput(typeof value === "string" ? value : JSON.stringify(value, null, 2)); setMode("capability-output"); };
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
    if (!session || !editor) throw new Error("Create a chat with Ctrl+N, or open a project with Ctrl+O. /new global starts without a project.");
    const firstSpace = text.indexOf(" ");
    const name = (firstSpace < 0 ? text : text.slice(0, firstSpace)).trim();
    const argument = firstSpace < 0 ? "" : text.slice(firstSpace + 1).trim();
    if (!text.startsWith("/") || name === "/steer" || name === "/interrupt") {
      if (documentCapture.current?.sessionId === session.id) throw new Error("Document extraction is still active. Wait or use Ctrl+C to cancel this capture before sending or holding its prompt.");
      if (pendingQuestion && !held && !text.startsWith("/")) { await editor.flush(); await client.questions.answerDraft(pendingQuestion.id, pendingQuestion.revision, otherQuestion === pendingQuestion.id); return; }
      if (!held && session.projectId && !text.startsWith("/") && continueWorkInput(text)) {
        setContinueReview(await editor.reviewContinueWork()); setMode("continue-work"); return;
      }
      if (name === "/steer" || name === "/interrupt") editor.edit(argument);
      await editor.send(name === "/steer" ? "steer" : name === "/interrupt" ? "interrupt" : "queue", held && !["/steer", "/interrupt"].includes(name));
      return;
    }
    const shared = parseSlash(text);
    if (shared?.name === "side" && shared.argument) {
      await editor.flush();
      const result = await client.slash(session.id, text, "tui"), saved = client.getState().snapshot?.sessions.find((entry) => entry.id === session.id)?.draft;
      if (saved) editor.receive(saved);
      await slashResult(result); return;
    }
    if (shared?.name === "continue-work") {
      await editor.flush(); await slashResult(await client.slash(session.id, text, "tui")); return;
    }
    if (shared?.name === "github" && /^(?:repos(?:\s|$)|issues$|pulls$)/.test(shared.argument)) {
      await editor.flush();
      if (shared.argument === "issues" || shared.argument === "pulls") await openGithubItems(shared.argument === "issues" ? "issue" : "pull");
      else {
        const query = shared.argument.slice(5).trim();
        await openGithubRepositories(query.startsWith("public ") ? "public" : "account", query.startsWith("public ") ? query.slice(7) : query);
      }
      editor.edit(""); await editor.flush(); return;
    }
    if (shared && (shared.name === "attach-document" || shared.name === "attach-file" && /\.(pdf|docx|xlsx)$/i.test(shared.argument))) {
      if (documentCapture.current) throw new Error("One document is already extracting in this TUI. Ctrl+C requests its exact stop.");
      await editor.flush();
      const id = crypto.randomUUID(); documentCapture.current = { sessionId: session.id, id };
      setNotice(`Extracting ${shared.argument.split(/[\\/]/).at(-1)} locally / ${id}. Ctrl+C cancels this capture; no model call.`);
      try {
        const result = await client.attachments.document(session.id, shared.argument, { captureId: id });
        const saved = client.getState().snapshot!.sessions.find((item) => item.id === session.id)!.draft;
        editor.receive(saved);
        if (!editor.getState().conflict && editor.getState().text === text) { editor.edit("", saved.attachments); await editor.flush(); }
        setNotice(`Captured document ${result.id}. /attached ID shows limitations; /document-read and /document-search inspect bounded content.`);
      } finally { documentCapture.current = null; }
      return;
    }
    if (shared && isSharedSlash(shared.name) && name !== "/help" && !(name === "/settings" && argument) &&
      !(name === "/linear" && argument === "token") && !(name === "/cache" && argument.startsWith("token "))) {
      await editor.flush(); editor.edit(""); await editor.flush();
      try { await slashResult(await client.slash(session.id, text, "tui")); }
      catch (error) { if (client.getState().snapshot?.sessions.some((item) => item.id === session.id && item.status !== "archived")) editor.edit(text); throw error; }
      return;
    }
    switch (name) {
      case "/config": {
        const [action, id, hash, consent] = argument.split(/\s+/);
        if (!action || action === "list") show(snapshot?.configurationProposals.filter((proposal) => (proposal.projectId === session.projectId || proposal.sessionId === session.id) && proposal.status === "pending"));
        else if (action === "review" && id) show(await client.configuration.review(id));
        else if ((action === "apply" || action === "reject") && id && hash) {
          if (action === "apply" && consent !== "acknowledge-risk") throw new Error("Review the exact scope/base/value, then use /config apply ID SHA256 acknowledge-risk. A model recommendation is not approval.");
          await client.configuration.decide(id, action === "apply", hash, action === "apply");
        } else throw new Error("Use /config list, review ID, apply ID SHA256 acknowledge-risk or reject ID SHA256.");
        break;
      }
      case "/notifications": show({ settings: snapshot?.settings.values.notifications, active: snapshot?.attention.filter((entry) => entry.active), note: "Use /settings edit for preferences. Desktop must run for OS banners. Read acknowledgement does not answer or approve." }); break;
      case "/issues": setMode("issues"); break;
      case "/issue": {
        const [operation, id, value] = argument.split(" ");
        if (operation === "new") openIssueEditor();
        else if (operation === "create") {
          if (!board || id !== "feature" && id !== "bug" && id !== "misc") throw new Error("Use /issue create feature|bug|misc TITLE, or /issue new for the full editor.");
          const title = argument.split(" ").slice(2).join(" ");
          await client.issues.create(requiredProject(), { title, body: "", kind: id, phaseId: board.columns[0]!.id, pullRequestUrl: null }); setMode("issues");
        }
        else if (operation === "edit") openIssueEditor(id);
        else {
          const issue = localIssues.find((issue) => issue.id === id) ?? snapshot?.issues.find((issue) => issue.id === id && issue.projectId === project?.id);
          if (!issue) throw new Error("Use /issues, then choose a project issue ID.");
          if (operation === "move" && value) await client.issues.move(issue.id, value, issue.revision);
          else if (operation === "archive" || operation === "restore") await client.issues.archive(issue.id, operation === "archive", issue.revision);
          else throw new Error("Use /issue new, edit ID, move ID PHASE, archive ID or restore ID.");
        }
        break;
      }
      case "/board":
        if (argument === "edit") openBoardEditor();
        else if (argument === "refresh") show(await client.issues.refresh(requiredProject()));
        else show(await client.issues.board(requiredProject()));
        break;
      case "/cache": {
        if (argument.startsWith("token ")) {
          const registryId = argument.slice(6);
          if (!snapshot?.dependencyRegistries.some((registry) => registry.id === registryId)) throw new Error("Choose an exact registry ID from /cache registries.");
          setTokenKind("cache"); setTokenServer(registryId); setTokenValue(""); setMode("mcp-token"); break;
        }
        throw new Error("Use the shared /cache commands. Registry credentials use /cache token ID's dedicated masked dialog.");
      }
      case "/linear":
        if (argument === "token") { setTokenKind("linear"); setTokenValue(""); setMode("mcp-token"); }
        else throw new Error("Use the shared /linear workflow commands; token opens the dedicated masked dialog.");
        break;
      case "/settings":
        if (argument === "edit") openSettingsEditor(false);
        else if (argument.startsWith("reset ")) {
          const section = argument.slice(6);
          if (section !== "all" && !Object.keys(snapshot!.settings.values).includes(section)) throw new Error("Choose all or an existing shared settings section.");
          await client.settings.reset(section as SettingsSection | "all", snapshot!.settings.revision);
        } else setMode("settings");
        break;
      case "/project-settings":
        if (argument === "edit") await openProjectEditor();
        else show(await client.projects.configuration(requiredProject()));
        break;
      case "/project-sources": show(await client.projects.sources(requiredProject())); break;
      case "/porto": show(await client.projects.porto(requiredProject())); break;
      case "/prompt":
        if (argument === "view") show(await client.prompt.preview(session.id));
        else if (argument === "reset") await client.prompt.reset(snapshot!.settings.revision);
        else openSettingsEditor(true);
        break;
      case "/memory": {
        const [operation, ...rest] = argument.split(" ");
        if (operation === "index") show(await client.memory.index(requiredProject(), session.workspaceId ?? undefined));
        else if (operation === "graph") show(await client.memory.graph(requiredProject(), rest.join(" "), session.workspaceId ?? undefined));
        else if (operation === "search") show(await client.memory.search(requiredProject(), rest.join(" "), 6, session.workspaceId ?? undefined));
        else if (operation === "remember") show(await client.memory.remember(requiredProject(), rest.join(" ")));
        else throw new Error("Use /memory index, graph, search TEXT or remember CONVENTION. Enable indexing in shared settings first.");
        break;
      }
      case "/skills":
      case "/plugins":
        if (!argument.startsWith("import ")) throw new Error("Use /skills import /path/SKILL.md or /plugins import /path/manifest.json.");
        show(name === "/skills" ? await client.capabilities.importSkill(requiredProject(), argument.slice(7)) : await client.capabilities.importPlugin(requiredProject(), argument.slice(7)));
        break;
      case "/capabilities": show({ registry: snapshot?.registry.filter((entry) => entry.projectId === session.projectId), proposals: snapshot?.proposals.filter((entry) => entry.projectId === session.projectId) }); break;
      case "/proposal": {
        const [operation, id, hash] = argument.split(" ");
        if (!id) throw new Error("Use /proposal view ID, then /proposal approve|reject ID SHA256 after reviewing the exact source.");
        if (operation === "view") show(await client.capabilities.proposal(id));
        else if (["approve", "reject"].includes(operation ?? "") && hash) await client.capabilities.decide(id, operation === "approve", hash);
        else throw new Error("Approval requires the exact reviewed SHA-256. Nothing auto-applies.");
        break;
      }
      case "/mcp": {
        const [operation, id = "builtin", ...rest] = argument.split(" ");
        if (operation === "servers") show(await client.mcp.servers(session.id));
        else if (operation === "tools") show(await client.mcp.tools(id, rest.join(" "), 0, session.id));
        else if (operation === "auth") show(await client.mcp.auth(id, session.id));
        else if (operation === "login") { const created = await client.mcp.oauthBegin(id, session.id); show(await client.mcp.oauthStatus(created.id!)); }
        else if (operation === "cancel") show(await client.mcp.oauthCancel(id));
        else if (operation === "clear-oauth") show(await client.mcp.oauthClear(id, session.id));
        else if (operation === "token" && !rest.length && id !== "builtin") { setTokenKind("mcp"); setTokenServer(id); setTokenValue(""); setMode("mcp-token"); }
        else if (operation === "call" && rest.length >= 3) {
          const [tool, hash, ...json] = rest;
          const args: unknown = JSON.parse(json.join(" "));
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Exact MCP arguments must be a JSON object.");
          show(await client.mcp.call(session.id, id, tool!, args as Record<string, unknown>, hash!));
          setMode("compose");
        } else throw new Error("Use /mcp servers, tools SERVER QUERY, auth SERVER, token SERVER, or call SERVER TOOL SHA256 JSON. Never put credentials in a composer command.");
        break;
      }
      case "/scripts": show(await client.mcp.tools("builtin", "", 0, session.id)); break;
      case "/result": show(await client.mcp.readResult(argument)); break;
      case "/subagent": show(await client.subagents.run(session.id, argument)); break;
      case "/dictate":
        if (argument === "status") show(await client.voice.status());
        else if (argument === "download accept-license") show(await client.voice.download(true));
        else if (argument === "record") await client.voice.record(session.id);
        else if (argument === "stop" && voiceJob) await client.voice.stop(voiceJob.id);
        else if (argument.startsWith("file ")) show(await client.voice.transcribe(session.id, argument.slice(5)));
        else if (argument === "insert" && latestTranscript) {
          editor.edit(""); await editor.flush();
          await client.voice.insert(session.id, latestTranscript.id, client.getState().snapshot!.sessions.find((item) => item.id === session.id)!.draft.revision);
          return;
        } else throw new Error("Use /dictate status, download accept-license, record, stop, file /path.wav or insert. Review OpenMDW-1.1 and the 708 MiB download first.");
        break;
      case "/connect": await client.command({ type: "provider.login" }); break;
      case "/disconnect": await client.command({ type: "provider.logout" }); break;
      case "/cancel-login": await client.command({ type: "provider.cancel" }); break;
      case "/local-models":
        if (argument === "refresh") { await client.models.refresh(); show(client.getState().snapshot?.provider); }
        else show({ endpoints: snapshot?.settings.values.localModels, connections: snapshot?.provider.connections, guidance: "Use /settings edit to configure exact URLs and model limits. /model-token ENDPOINT opens masked input; no inference or scan occurs during discovery." });
        break;
      case "/model-token":
        if (!argument || argument.includes(" ")) throw new Error("Use /model-token ENDPOINT_ID, then the masked input. Never put a credential in the composer.");
        setTokenKind("model"); setTokenServer(argument); setTokenValue(""); setMode("mcp-token"); break;
      case "/remote-model-token":
        if (!argument || argument.includes(" ")) throw new Error("Use /remote-model-token ENDPOINT_ID after probing SSH, then the masked input. Never put a credential in the composer.");
        setTokenKind("remote-model"); setTokenServer(argument); setTokenValue(""); setMode("mcp-token"); break;
      case "/defaults": show({ global: snapshot?.settings.values.startup.global, profile: snapshot?.settings.values.startup.profile, project: session.projectId ? snapshot?.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.values.defaults ?? {} : {}, current: session.controls, sources: session.defaults, guidance: "Edit shared startup settings or project overrides. Existing sessions are never rewritten by default changes." }); break;
      case "/env":
        if (!["Local", "Sandbox", "Remote"].includes(argument)) throw new Error("Use /env Local, Sandbox, or Remote. Unready backends are rejected.");
        await client.sessions.env(session.id, argument as Controls["env"]); break;
      case "/autonomy":
        if (!["Manual", "Guided", "Autopilot", "Autopilot Max"].includes(argument)) throw new Error("Choose Manual, Guided, Autopilot or Autopilot Max. Max requires an explicitly configured compatible bounded provider and exact delegated policy.");
        await client.sessions.autonomy(session.id, argument as Controls["autonomy"]); break;
      case "/attach":
        if (!argument) throw new Error("Use /attach path/to/project-file. Only explicit project UTF-8 snapshots are supported.");
        await editor.attach(argument); editor.edit(""); await editor.flush(); return;
      case "/detach":
        if (!editor.getState().attachments.some((attachment) => attachment.path === argument || attachment.id === argument)) throw new Error("Use /detach with an attached project path or snapshot ID.");
        editor.edit("", editor.getState().attachments.filter((attachment) => attachment.path !== argument && attachment.id !== argument)); await editor.flush(); return;
      case "/stop": await client.command({ type: "session.stop", sessionId: session.id }); break;
      case "/archive": await client.command({ type: "session.archive", sessionId: session.id }); break;
      case "/restore": await client.command({ type: "session.restore", sessionId: session.id }); break;
      case "/resume": await client.command({ type: "session.resume", sessionId: session.id }); break;
      case "/queue": setMode("queue"); break;
      case "/remove":
        await client.command({ type: "queue.remove", sessionId: session.id, messageId: argument, expectedRevision: session.queueRevision }); break;
      case "/queue-turn":
        await client.command({ type: "queue.make-turn", sessionId: session.id, messageId: argument, expectedRevision: session.queueRevision }); break;
      case "/edit": {
        const separator = argument.indexOf(" ");
        if (separator < 0) throw new Error("Use /edit MESSAGE_ID replacement text.");
        await client.command({ type: "queue.edit", sessionId: session.id, messageId: argument.slice(0, separator), expectedRevision: session.queueRevision, text: argument.slice(separator + 1) }); break;
      }
      case "/reorder":
        await client.command({ type: "queue.reorder", sessionId: session.id, expectedRevision: session.queueRevision, messageIds: argument.split(/\s+/) }); break;
      case "/policy":
        if (!["all", "protected"].includes(argument)) throw new Error("Use /policy all or /policy protected. Protected blocks new Local turns.");
        await client.command({ type: "policy.set", allowedEnvs: argument === "all" ? ["Local", "Sandbox", "Remote"] : ["Sandbox", "Remote"] }); break;
      case "/reload-draft": editor.reload(); return;
      case "/keep-draft": await editor.keepMine(); return;
      case "/new":
        if (argument && argument !== "global") throw new Error("Use /new or /new global for a project-free chat.");
        await newSession(argument === "global"); break;
      case "/open": await openProject(argument); break;
      case "/sessions": setMode("sessions"); break;
      case "/trace": setMode("trace"); break;
      case "/details": setDetailed((value) => !value); break;
      case "/help": {
        const catalog = await client.commands.list(session.id);
        setSkillHelp({ profileId: client.profileId, text: catalog.filter((entry) => entry.kind === "skill").map((entry) => `/${entry.name}  Skill / ${entry.skill.sourceName}: ${entry.description}`).join("\n") });
        setMode("help"); break;
      }
      default: {
        if (shared && (await client.commands.list(session.id)).some((entry) => entry.kind === "skill" && entry.name === shared.name)) {
          await editor.flush(); const result = await client.slash(session.id, text, "tui");
          const saved = client.getState().snapshot?.sessions.find((entry) => entry.id === session.id)?.draft;
          if (saved) editor.receive(saved);
          await slashResult(result); return;
        }
        throw new Error("Unknown slash command. Use /help. Ordinary @, ^, :, # and ! text stays literal.");
      }
    }
    editor.edit(""); await editor.flush();
  };
  useKeyboard((key) => {
    if (switchingProfile.current) { key.preventDefault(); key.stopPropagation(); return; }
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
      else if (key.name === "return" && tokenValue) void perform(async () => { if (tokenKind === "linear") await client.linear.setToken(tokenValue); else if (tokenKind === "cache") await client.cache.registries.setToken(tokenServer, tokenValue); else if (tokenKind === "model") await client.models.setToken(tokenServer, tokenValue); else if (tokenKind === "remote-model") await client.remote.setToken(tokenServer, tokenValue); else await client.mcp.setToken(tokenServer, tokenValue, session?.id); setTokenValue(""); setMode("settings"); });
      else if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " ") setTokenValue((value) => (value + key.sequence).slice(0, 32768));
      return;
    }
    if (key.name === "escape") { setContinueReview(null); setMode("compose"); return; }
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
    }
    if (key.ctrl && key.name === "q" && editorModes.includes(mode)) { key.preventDefault(); setNotice("Save with Ctrl+Enter or cancel with Esc before leaving this editor."); return; }
    if (editorModes.includes(mode)) {
      if (key.ctrl && key.name === "r" && ["prompt-editor", "settings-editor"].includes(mode)) { key.preventDefault(); void perform(async () => { await client.settings.reset(mode === "prompt-editor" ? "systemPrompt" : "all", settingsRevision.current); setMode("settings"); }); }
      return;
    }
    if (key.name === "f5") { key.preventDefault(); setMode("artifacts"); return; }
    if (key.name === "f7") {
      key.preventDefault(); void perform(async () => {
        const [overview, budget, profiles, operations, storage] = await Promise.all([client.dashboard.overview(), client.budgets.dashboard(), client.profiles.list(), client.telemetry.operations({ limit: 10 }), client.telemetry.storage()]);
        show({ ...overview, budget, globalBudget: profiles.catalog.globalBudget, operations, storage: storage.storage });
      }); return;
    }
    if (key.name === "f8") { key.preventDefault(); void perform(openProfiles); return; }
    if (key.name === "f6") { key.preventDefault(); if (pendingQuestion) setMode("question"); else setNotice("No actual pending question is owned by this turn."); return; }
    if (mode === "compose" && ["return", "kpenter"].includes(key.name) && (key.ctrl || key.meta || key.super) && !session?.pendingApproval) {
      key.preventDefault(); key.stopPropagation();
      if (editor) void perform(() => submit(editor.getState().text, !key.shift));
      return;
    }
    if (key.name === "f4") { key.preventDefault(); void insertTranscript(); return; }
    if (!key.ctrl) return;
    if (["q", "c", "o", "n", "l", "m", "p", "k", "b", "y", "d", "a", "r", "s", "v", "g", "space"].includes(key.name)) key.preventDefault();
    if (key.name === "g") { setMode("settings"); return; }
    if (key.name === "space") { void dictate(); return; }
    if (key.name === "q") void perform(async () => {
      for (const editor of editors.current.values()) await editor.flush();
      for (const editor of editors.current.values()) editor.dispose();
      client.disconnect();
      if (onQuit) onQuit(); else renderer.destroy();
    });
    else if (key.name === "c" && documentCapture.current?.sessionId === session?.id) {
      const capture = documentCapture.current;
      if (capture) void perform(() => client.attachments.cancelDocument(capture.sessionId, capture.id));
    }
    else if (key.name === "c" && session?.turnId) void command({ type: "session.stop", sessionId: session.id });
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
  const options = snapshot?.sessions.filter((item) => (item.status === "archived") === showArchived).sort(compareSessions).map((item) => {
    const attention = snapshot.settings.values.notifications.inApp ? snapshot.attention.findLast((entry) => entry.sessionId === item.id && entry.active) : undefined;
    const prefix = attention ? attention.kind === "question" ? "? " : attention.kind === "done" ? "o " : "! " : "";
    return { name: `${prefix}${safe(label(item))}`, description: `${snapshot.projects.find((project) => project.id === item.projectId)?.name ?? (item.repositories ? `${item.repositories.length} repositories` : "No project")} / ${item.status}`, value: item.id };
  }) ?? [];
  return <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
    <box height={3} paddingLeft={2} paddingRight={2} alignItems="center" flexDirection="row" border={["bottom"]} borderColor={colors.border}>
      <text fg={colors.accent}><strong>moguri</strong></text><text fg={colors.muted}>  /  {safe(snapshot?.profile?.name ?? client.profileId)}  /  {safe(project?.name ?? (session?.repositories ? `${session.repositories.length} captured repositories` : session ? "No project" : "Workspace"))}  /  {profilePending ? "Updating profile..." : status}</text>
    </box>
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {width >= 100 && <box width={26} border={["right"]} borderColor={colors.border} padding={1} flexDirection="column">
        <text fg={colors.muted}>{showArchived ? "ARCHIVED" : "SESSIONS"}  Ctrl+P</text>
        {options.length ? <select flexGrow={1} options={options} focused={mode === "sessions"} selectedBackgroundColor={colors.panel} selectedTextColor={colors.accent} textColor={colors.foreground} descriptionColor={colors.muted}
          onSelect={(_, option) => { if (option?.value) void perform(() => chooseSession(String(option.value))); }} /> : <text fg={colors.muted}>{"\nNo sessions yet.\n\nCtrl+O open project\nCtrl+L connect Copilot"}</text>}
        <text fg={colors.muted}>{"Ctrl+N new session\nCtrl+A active/archive\nF8 profiles\nCtrl+Q save and leave"}</text>
      </box>}
      <box flexGrow={1} minWidth={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
        {mode === "profiles" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Profiles / {safe(snapshot?.profile?.name ?? client.profileId)}</text>
          <text fg={colors.muted} height={3}>Accounts, projects, drafts and memory stay separate. Switching does not stop owned work. New profiles copy no private data or model selection.</text>
          <select focused={!profilePending} flexGrow={1} options={[
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
          <select focused={!profilePending} flexGrow={1} options={[{ name: profileEditor.current?.status === "creating" ? "Stop this owned profile setup" : "I inspected owned resources: retry setup", description: "Explicit user action; partial effects are preserved.", value: "recover" }, { name: "Return without changing setup", description: "No retry or cancellation is inferred.", value: "return" }]} onSelect={(_, option) => { if (!option || switchingProfile.current) return; void perform(async () => {
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
          <select focused={!githubBusy} flexGrow={1} options={[...(githubRepositories?.repositories ?? []).map((repository) => ({ name: safe(repository.fullName), description: `${repository.relationship} / ${repository.visibility}`, value: String(repository.id) })),
            ...(githubRepositories?.nextPage ? [{ name: "Load next repository page", description: "Explicit bounded page, same account.", value: "next" }] : [])]} onSelect={(_, option) => {
            if (!option || githubBusy) return;
            if (option.value === "next" && githubRepositories?.nextPage) { void perform(() => openGithubRepositories(githubSearch.current.source, githubSearch.current.query, githubRepositories.nextPage!, githubRepositories.account, githubRepositories.accountId)); return; }
            const selected = githubRepositories?.repositories.find((entry) => String(entry.id) === option.value);
            if (selected) { setGithubRepository(selected); setProjectPath(""); setGithubCloneJob(null); setMode("github-clone"); }
          }} /><text fg={colors.muted} height={2}>Enter selects. /github repos public QUERY searches public repositories. Esc returns.</text></box> :
        mode === "github-clone" ? <box flexDirection="column" flexGrow={1} paddingTop={1} gap={1}>
          <text fg={colors.accent}>Clone {safe(githubRepository?.fullName ?? "")}</text>
          <text fg={colors.muted} height={4}>Enter a new absolute destination in an existing parent folder. Enter explicitly clones and starts an idle session. No hooks, submodules, model call or automatic authentication. Cancellation preserves partial files.</text>
          <input focused={!githubBusy && !githubCloneJob} placeholder="/absolute/path/to/new-checkout" value={projectPath} onInput={setProjectPath} onSubmit={() => {
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
          <select focused={!githubBusy} flexGrow={1} options={[...(githubItems?.items ?? []).map((item) => ({ name: safe(`#${item.number} ${item.title}`), description: item.draft ? "draft" : safe(item.state), value: String(item.number) })),
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
        mode === "github-detail" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>{safe(`${githubSelection?.source.repository}#${githubSelection?.item.number} ${githubSelection?.item.title}`)}</text>
          <scrollbox focused={!githubBusy} flexGrow={1}><text fg={colors.foreground}>{safe(`${githubSelection?.item.state}\n\n${githubSelection?.item.body ?? ""}\n\nController source workspace: ${githubSelection?.binding.root.root}\nSource SHA-256: ${githubSelection?.digest}`)}</text></scrollbox>
          <text fg={colors.attention} height={3}>Ctrl+N starts a session with this exact source as an unsent draft. Ctrl+L links it here. Ctrl+B opens GitHub. No checkout or inference is started. Esc returns.</text></box> :
        mode === "continue-work" && continueReview ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Continue work / choose for this request</text>
          <text fg={colors.muted} height={4}>Work from Kanban, or send this exact prompt to the model? Esc cancels and preserves the draft. No route is remembered.</text>
          <select flexGrow={1} focused options={[
            { name: "Work from Kanban", description: "One actual project item in an isolated Local checkout, through its PR", value: "kanban" },
            { name: "Send to model", description: "Send the unchanged prompt through the normal chat and permissions", value: "prompt" },
          ]} selectedBackgroundColor={colors.panel} selectedTextColor={colors.accent} textColor={colors.foreground} descriptionColor={colors.muted}
            onSelect={(_, option) => { if (option?.value === "kanban" || option?.value === "prompt") {
              const choice = option.value, review = continueReview;
              void perform(async () => {
                if (!editor || editor.sessionId !== review.sessionId) throw new Error("The original continuation owner changed. No draft was consumed.");
                await editor.chooseContinueWork(review, choice);
                setContinueReview(null); setMode("compose");
              });
            } }} />
        </box> :
        mode === "question" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent} height={2}>Actual user question / no tool permission grant</text>
          {pendingQuestion ? <><scrollbox height={10}><text fg={colors.foreground}>{safe(questionDetails)}</text></scrollbox>
            <select focused flexGrow={1} options={[...pendingQuestion.choices.flatMap((choice, index) => choice === "Other, please specify" ? [] : [{ name: safe(choice), description: "Answer as the actual user. Does not authorize tools.", value: `choice:${index}` }]), { name: "Other, please specify", description: "Type a custom answer in the saved composer. Enter submits; Cmd/Ctrl+Enter still holds.", value: "other" }, ...(pendingQuestion.allowFreeform ? [{ name: "Type a freeform answer in the saved composer", description: "Enter answers; Cmd/Ctrl+Enter still holds a queue.", value: "freeform" }] : [])]} onSelect={(_, option) => {
              if (!option) return;
              if (option.value === "other" || option.value === "freeform") { setOtherQuestion(option.value === "other" ? pendingQuestion.id : null); setMode("compose"); setNotice("Type your actual answer. Enter answers; Shift+Enter inserts a newline. Cmd/Ctrl+Enter still queues."); return; }
              const index = Number(String(option.value).slice(7)), choice = pendingQuestion.choices[index];
              if (choice === undefined) { setNotice("This offered answer is no longer available. Review the current question."); return; }
              void perform(async () => { await client.questions.answer(pendingQuestion.id, choice, pendingQuestion.revision); setMode("compose"); });
            }} /></> : <text fg={colors.muted}>This question was answered or cancelled. Esc returns without inventing an answer.</text>}
          <text fg={colors.muted} height={3}>Never enter credentials. Use connection settings. Source provenance is retained; model confidence cannot grant policy. Esc returns.</text></box> :
        mode === "settings" ? <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text fg={colors.accent}><strong>Shared Moguri SDK settings</strong></text><text fg={colors.muted}>Same settings and APIs as desktop. Optional subagents/evolution start off.</text>
          <select focused flexGrow={1} options={[
            { name: "System prompt: view, edit, restore", value: "prompt" },
            { name: "All shared settings (JSON): dark theme, guardrails, memory, MCP, optional modes", value: "json" },
            { name: "Project settings (JSON): repo, folders, scripts, preview port, instructions and MCP", value: "project" },
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
              case "prompt": openSettingsEditor(true); break;
              case "json": openSettingsEditor(false); break;
              case "project": await openProjectEditor(); break;
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
            <text fg={colors.accent} height={4} flexShrink={0}>Wind-down metadata only. Reserved capacity, actual model input/result and separate actual-user Git approval/publication are immutable. Ctrl+Enter saves metadata; Esc discards. /winddown inspects data, not permission or source acceptance.</text> :
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
          <select focused flexGrow={1} options={[{ name: "+ New retained document", description: "Plan, decision, answer, research note or report.", value: "" }, ...(snapshot?.artifacts ?? []).map((artifact) => ({ name: safe(artifact.name), description: `${artifact.kind} / ${artifact.status} / revision ${artifact.revision} / ${artifact.projectId ? snapshot?.projects.find((project) => project.id === artifact.projectId)?.name ?? "Former project" : "Profile"}`, value: artifact.id }))]} onSelect={(_, option) => { if (option) void perform(() => openArtifact(String(option.value) || undefined)); }} />
          <text fg={colors.muted} height={3}>Enter edits text, folderId and workItemId. /artifact ID reads provenance. /project-removal materialize-preview reviews a repository copy. F5 works without a session. Esc returns.</text></box> :
        mode === "work-items" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Project work item / {safe(project?.name ?? "Choose a project")}</text>
          <select focused flexGrow={1} options={[{ name: "GitHub issues", description: "Read this project's actual signed-in account.", value: "github" },
            { name: "Clear Kanban work item", description: "Metadata only; no card is deleted.", value: "" }, ...localIssues.map((issue) => ({ name: `#${issue.number} ${safe(issue.title)}`,
              description: issue.linear ? `Linear ${safe(issue.linear.identifier)} / retained local card` : "Project Kanban card / no inference", value: issue.id }))]}
            onSelect={(_, option) => { if (!option || !session) return; void perform(async () => {
              if (option.value === "github") { await openGithubItems("issue"); return; }
              await client.sessions.organize(session.id, { workItemId: String(option.value) || null, ...(option.value ? { workItemUrl: null } : {}) }); setMode("compose"); setNotice("Kanban work item updated.");
            }); }} />
          <text fg={colors.muted} height={3}>Enter links a card, or opens the GitHub picker. /continue-work [CARD_ID] asks Kanban or model for this request. Esc returns.</text></box> :
        mode === "issues" ? <box flexDirection="column" flexGrow={1} paddingTop={1}><text fg={colors.accent} height={2}>Local project Kanban / {safe(project?.name ?? "Open a project first")}</text>
          <text fg={colors.muted} height={3}>{board?.columns.map((column) => `${safe(column.name)}: ${localIssues.filter((issue) => issue.phaseId === column.id).length}`).join("  |  ") ?? "No project selected."}</text>
          <select focused flexGrow={1} options={[{ name: "+ New local issue", description: "Feature, bug or misc. No assignee.", value: "" }, ...localIssues.map((issue) => ({
            name: `#${issue.number} ${safe(issue.title)}`, description: `${issue.kind} / ${safe(board?.columns.find((column) => column.id === issue.phaseId)?.name ?? issue.phaseId)}${issue.pullRequest ? ` / PR ${issue.pullRequest.state}` : ""}`, value: issue.id,
          }))]} onSelect={(_, option) => { if (option) void perform(async () => openIssueEditor(String(option.value) || undefined)); }} />
          <text fg={colors.muted} height={4}>Enter edits JSON. /continue-work [CARD_ID] asks Kanban or model each time. /work-item picks a card. /kanban source selects open GitHub work. /board edit configures phases/sync/Linear. Esc opens this board's chat.</text></box> :
        mode === "capability-output" ? <scrollbox flexGrow={1} focused><text fg={colors.foreground}>{safe(capabilityOutput)}</text></scrollbox> :
        mode === "mcp-token" ? <box flexDirection="column" flexGrow={1} paddingTop={2}><text fg={colors.accent}>{tokenKind === "linear" ? "Linear personal API key" : tokenKind === "cache" ? `Private registry credential for ${tokenServer}` : tokenKind === "model" ? `Local model credential for ${tokenServer}` : `MCP credential for ${tokenServer}`}</text><text fg={colors.muted}>This masked input is not a draft or model message. Enter stores it in the OS keychain; Esc discards it.</text><text fg={colors.foreground}>{"*".repeat(Math.min(tokenValue.length, 60))}</text></box> :
        mode === "project" ? <box flexDirection="column" paddingTop={2} gap={1}><text fg={colors.accent}>Open a local project directory</text><text fg={colors.muted}>Local execution is not sandboxed. Tools follow the selected autonomy and hard policy.</text>
          <input focused value={projectPath} onInput={setProjectPath} placeholder="/absolute/path/to/project" onSubmit={() => void perform(() => openProject(projectPath))} /></box> :
        mode === "models" ? <box flexGrow={1} flexDirection="column" paddingTop={1}><text fg={colors.accent}>Select an available model</text>
          {availableModels.length ? <select focused flexGrow={1} options={availableModels.map((model) => ({ name: model.name, description: model.synthetic ?
            model.environments && !model.environments.includes(session?.controls.env ?? "Local") ? `Unavailable: ${snapshot?.routingDiagnostics?.join(" ") ?? "No eligible model in this environment."}` :
              snapshot?.settings.values.kupo.workflow === "auto" ? "Automatic Single / Cascade / eligible Critique; every actual role is metered" :
                snapshot?.settings.values.kupo.workflow === "compound" ? "Moguri reviewed compound / separately metered actual roles" : "Moguri Single alpha / separately metered router and solver" : `${model.contextWindow} context tokens / ${model.source === "local" ? model.providerId : "GitHub Copilot"}`, value: model.id }))}
            onSelect={(_, option) => {
              if (!session) { setNotice("Create a chat with Ctrl+N before choosing its model."); return; }
              const model = availableModels.find((model) => model.id === option?.value);
              if (model?.environments && !model.environments.includes(session.controls.env)) { setNotice(`Kupo is unavailable in ${session.controls.env}. ${snapshot?.routingDiagnostics?.join(" ") ?? ""}`); return; }
              if (option?.value) void perform(async () => { const { modelOptions: _, ...controls } = session.controls; await configure({ ...controls, modelId: String(option.value) }, true); setMode("compose"); });
            }} /> :
            <text fg={colors.muted}>{session?.controls.env === "Remote" ? "No model approved on this SSH host. Use /remote probe; explicitly allow scoped Copilot access or configure remote endpoints." : "No available models. Ctrl+L connects Copilot; /local-models explains explicit local endpoint setup."}</text>}
          <text fg={colors.muted} height={4} flexShrink={0}>Kupo uses configured models by default. One eligible model runs directly; multiple models support automatic Single, gated Cascade or eligible Critique. /kupo status shows capabilities and policy. Normal approvals remain authoritative. /compound keeps separate worktree/test review.</text></box> :
        mode === "sessions" && width < 100 ? <select focused flexGrow={1} options={options} onSelect={(_, option) => { if (option?.value) void perform(() => chooseSession(String(option.value))); }} /> :
        mode === "help" ? <scrollbox flexGrow={1} focused><text fg={colors.foreground}>{`Commands

Ctrl+O open project    Ctrl+N new session    Ctrl+P sessions
Ctrl+L Copilot login   Ctrl+M model picker   Cmd/Ctrl+Enter held queue
Shift+Cmd/Ctrl+Enter send now
Ctrl+C stop turn      Ctrl+Y approve tool   Ctrl+D deny tool
Ctrl+B event trace    Ctrl+A archive view   Ctrl+Q save and leave
Ctrl+R reload draft  Ctrl+S save/keep my draft after a conflict
Ctrl+V scroll full approval arguments
Ctrl+G shared SDK settings  Ctrl+Space local dictation  F4 insert transcript
F5 retained documents / artifact editor (also without a session)
F7 profile usage dashboard (also without a session)
F8 isolated profile picker, create, rename and setup inspection
F6 actual pending question choices. Shift+Cmd/Ctrl+Enter answers from saved text.
Esc composer

/connect | /cancel-login | /disconnect | /models | /model ID
/model-settings [JSON|reset] configures working context/thinking via the shared SDK
/local-models [refresh] inspects configured endpoints without inference or host scans
/remote [probe|reconcile ID|acknowledge ID] uses pinned SSH, never Local fallback
/remote-model-token ENDPOINT opens masked remote endpoint credential input
/model-token ENDPOINT opens a masked endpoint-key input; /defaults shows startup sources
/new global creates a chat without a workspace
/meta [REQUEST] | /suggestions [all|run DIGEST|run-all DIGEST] | /attention
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
/archive | /restore | /new | /open PATH | /sessions
/trace | /details | /reload-draft | /keep-draft
/policy all | /policy protected
/settings | /settings edit | /settings reset SECTION
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

${slashCommands.map((entry) => `/${entry.name}${"argument" in entry ? ` ${entry.argument}` : ""}  ${entry.description}`).join("\n")}
${skillHelp?.profileId === client.profileId ? safe(skillHelp.text) : ""}

Native Sandbox uses /sandbox setup for bundled runtime/image review, followed
by its exact /sandbox enable command. Managed workspaces and selected-provider
DNS aliases are automatic; /sandbox updates never changes the selected version.
Advanced exact-file staging remains optional. Source publication is separate
actual-user acceptance. /compound owns reviewed Local Cascade/Critique
and separately approved project tests. /winddown reviews reserved Local finishing
and separate accepted-work Git checkpoints. Local Max needs an explicitly
configured bounded decision provider; /decisions status/set/read exposes only
shared policy and actual evidence, never a fake user answer or new permission.
Jev and Remote/native Max remain unqualified.
Kupo is always listed. Select /model kupo to use configured eligible models.
/kupo status shows capability categories and policy. Finite automatic caps stay blocked;
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
        mode === "trace" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Recent events (last 200 received)</text>{events.filter((event) => !session || event.session_id === session.id).map((event) => <text key={event.id} fg={colors.muted}>{safe(`#${event.seq} ${event.event_type}\n${JSON.stringify(event.payload)}\n`)}</text>)}</scrollbox> :
        mode === "queue" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Held prompts do not run. /run ID releases one. /edit, /remove, /reorder and /copy ID manage prompts.</text>{session?.queue.map((item) => <text key={item.id} fg={colors.foreground}>{safe(`\n${item.id} [${item.held ? "held" : item.delivery}]\n${item.text}\n${item.attachments.map((attachment) => `${attachment.path} [${attachmentStatus(attachment)}] ${attachment.id}`).join("\n")}\n`)}</text>)}</scrollbox> :
          <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom">
            {!session?.messages.length && <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={1}><text fg={colors.accent}>{MOGURI_ASCII}</text><text fg={colors.accent}><strong>What are we working on?</strong></text><text fg={colors.muted}>{session ? "Choose a model with Ctrl+M, then write a prompt below.\nYou approve each tool before it runs." : "Ctrl+O opens a project. Ctrl+L connects GitHub Copilot.\nSessions and drafts are shared with the desktop app."}</text></box>}
            {session?.messages.slice(detailed ? 0 : -150).map((message) => <box key={message.id} flexDirection="column" paddingTop={1} paddingBottom={1}>
              <text fg={message.role === "user" ? colors.accent : message.role === "notice" ? colors.attention : colors.muted}><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Moguri" : message.role === "tool" ? message.toolCalls?.[0]?.name ?? "Tool" : "Session"}</strong>{message.outcome ? ` / ${message.outcome}` : ""}</text>
              <text fg={colors.foreground}>{safe((detailed ? message.text : message.text.slice(-4000)) || (message.toolCalls?.length ? "Requesting tool access." : "Working..."))}</text>
              {detailed && message.reasoning && <text fg={colors.muted}>{safe(`Provider-exposed reasoning:\n${message.reasoning}`)}</text>}
              {message.attachments?.filter((attachment) => attachment.kind === "document").map((attachment) => <text key={attachment.id} fg={colors.accent}>{safe(`${attachment.path} [${attachmentStatus(attachment)}] ${attachment.id}`)}</text>)}
            </box>)}
          </scrollbox>}
        {mode === "compose" && continuedWork && <box flexDirection="column" border borderColor={colors.accent} padding={1} flexShrink={0}>
          <text fg={colors.accent}>{safe(`${continuedWork.source.title}: ${continuedWork.status} / one delegated task to its PR`)}</text>
          <text fg={colors.muted}>{safe(continuedWork.diagnostic ?? (continuedWork.prUrl ? `PR: ${continuedWork.prUrl}` : `Open its child in the sessions list, or inspect /kanban work ${continuedWork.id}.`))}</text>
        </box>}
        {snapshot?.provider.login && <box flexDirection="column" border borderColor={colors.accent} padding={1}>
          <text fg={colors.accent}>GitHub Copilot sign-in: {snapshot.provider.login.code}</text><text fg={colors.foreground}>{snapshot.provider.login.url}</text><text fg={colors.muted}>Authorize in your browser. /cancel-login cancels. Account model policies may be enabled.</text>
        </box>}
        {snapshot?.provider.diagnostic && <text fg={colors.attention}>{safe(snapshot.provider.diagnostic)}</text>}
        {session?.pendingApproval && <box flexDirection="column" border borderColor={colors.attention} padding={1} height={mode === "approval-choices" ? 17 : 10} flexShrink={0}>
          <text fg={colors.attention}><strong>Approval required: {session.pendingApproval.call.name}</strong></text>
          {mode === "approval-choices" ? <select focused flexGrow={1} options={[
            { name: "Approve only this action", description: "No remembered grant.", value: "once" },
            { name: "Approve for this session", description: "Same exact command/arguments or MCP tool.", value: "session:exact" },
            ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: "Approve for this project", description: "All sessions of the selected repository, current environment.", value: "project:exact" }] : []),
            { name: "Always approve across this profile", description: "Same exact command/arguments or schema-bound MCP tool.", value: "global:exact" },
            ...(!["run_command", "command_job", "debug", "mcp_gateway"].includes(session.pendingApproval.call.name) ? [
              { name: `Always approve ${session.pendingApproval.call.name} for this session`, description: "New arguments, same actual session and environment.", value: "session:tool" },
              ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: `Always approve ${session.pendingApproval.call.name} for this project`, description: "New arguments in the selected repository; hard restrictions still apply.", value: "project:tool" }] : []),
              { name: `Always approve ${session.pendingApproval.call.name} globally`, description: "Current profile and environment; not a command or MCP wildcard.", value: "global:tool" },
            ] : []),
            ...((session.pendingApproval.call.name === "run_command" || session.pendingApproval.call.name === "command_job" && session.pendingApproval.call.arguments.action === "start") &&
              typeof session.pendingApproval.call.arguments.command === "string" && commandFamily(session.pendingApproval.call.arguments.command) ? [
                ...(approvalProject(session, session.pendingApproval.call.arguments.repository) ? [{ name: `Always approve ${commandFamily(session.pendingApproval.call.arguments.command)} for this project`, description: "Any simple command arguments in this repository; compound expressions still ask.", value: "project:family" }] : []),
                { name: `Always approve ${commandFamily(session.pendingApproval.call.arguments.command)} globally`, description: "Current profile and environment. Hard denials still win.", value: "global:family" },
              ] : []),
          ]} onSelect={(_, option) => {
            if (!option || !session.pendingApproval) return;
            const [scope, match] = String(option.value).split(":");
            void perform(async () => { await client.approvals.respond(session.id, session.pendingApproval!.id, true, scope === "once" ? undefined : parse(RememberApprovalSchema, { scope, match })); setMode("compose"); });
          }} /> : <scrollbox flexGrow={1} focused={mode === "approval"}><text fg={colors.foreground}>{safe(`${JSON.stringify(session.pendingApproval.call.arguments, null, 2)}${approvalAdvice ? `\n\nModel advice (not approval): ${approvalAdvice}` : session.controls.autonomy === "Guided" ? "\n\nThe current solver supplied no explicit recommendation. You must decide." : ""}`)}</text></scrollbox>}
          <text fg={colors.attention}>{session.pendingApproval.call.name === "run_command" ? session.controls.env === "Remote" ? "SSH host, not SendBox. " : session.controls.env === "Sandbox" ? "Approved SendBox boundary. " : "Unsandboxed Local. " : session.pendingApproval.call.name === "fetch_page" ? "Approved Sandbox network hosts. " : "Project access. "}Ctrl+Y once | Ctrl+Shift+Y remember | Ctrl+D deny | Ctrl+V args</text>
        </box>}
        {pendingQuestion && mode !== "question" && <box flexDirection="column" border borderColor={colors.attention} padding={1} height={recommendation ? 11 : 9} flexShrink={0}><text fg={colors.attention} height={1} flexShrink={0}><strong>Your actual answer is needed / F6 choices</strong></text><text fg={colors.foreground} height={2} flexShrink={0}>{safe(pendingQuestion.question).slice(0, 320)}</text>{recommendation && <text fg={colors.muted} height={2} flexShrink={0}>Model advises: {safe(recommendation.choice)}. F6 shows its reason; no answer was recorded.</text>}<text fg={colors.muted} height={2} flexShrink={0}>Enter answers; Shift+Enter inserts a newline. Cmd/Ctrl+Enter still queues. No tool permission is granted.</text></box>}
        {session?.localFinishing && <text fg={colors.attention}>Local finishing: new Local turns are blocked by policy.</text>}
        {notice || error ? <text fg={colors.error}>{safe(notice || error || "")}</text> : null}
        {snapshot?.jobs.filter((job) => job.status === "running" && (!job.sessionId || job.sessionId === session?.id)).slice(-2).map((job) => <text key={job.id} fg={colors.accent}>{safe(`${job.kind}: ${job.progress} (${job.id})`)}</text>)}
        {latestTranscript && <text fg={colors.accent}>Local transcript ready. F4 inserts it into the draft; it is never sent automatically.</text>}
        {mode === "compose" && session && editor && <TuiComposer key={session.id} editor={editor} session={session} focused={!session.pendingApproval}
          submit={() => void perform(() => submit(editor.getState().text))} run={perform} />}
        <box height={taskProgress.progress?.longRunning && taskProgress.progress.model ? 5 : 4} flexShrink={0} flexDirection="column">
          <text fg={colors.muted}>{session ? `Env ${session.controls.env} | Model ${session.controls.modelId ?? "not set (Ctrl+M)"}` : "Env Local | Model not set"}</text>
          <text fg={colors.muted}>{`Autonomy level ${session?.controls.autonomy ?? "Manual"} | Budget ${session?.controls.budget.kind === "limited" ? "estimated cap" : "Unlimited"}${snapshot?.budgetPolicy.limit ? " / profile cap" : ""}`}</text>
          <text fg={colors.muted}>{session ? `${session.pendingMode ? `${session.pendingMode} pending` : session.mode} | ${session.status} | ${session.queue.length} queued | ${session.usage.length} model calls${session.kind === "side" ? " | main context per question" : ""}` : "Factory defaults. Ctrl+K commands."}</text>
          {session && <text fg={taskProgress.error ? colors.attention : colors.muted}>{safe(`Plan ${progressBar(taskProgress.progress?.checklist.percent ?? null, 8)} / ${taskProgress.error ? "unavailable, /progress" : taskProgress.progress?.checklist.total ? `${taskProgress.progress.checklist.completed}/${taskProgress.progress.checklist.total}` : "no checklist"} / estimate, 15s`)}</text>}
          {taskProgress.progress?.longRunning && taskProgress.progress.model && <text fg={colors.attention}>{safe(`Model estimate ${progressBar(taskProgress.progress.model.percent, 8)}${taskProgress.progress.model.stale ? " (stale)" : ""}${taskProgress.progress.disagreement ? " / differs from plan" : ""} /progress for details`)}</text>}
        </box>
      </box>
    </box>
    <box height={3} paddingLeft={2} border={["top"]} borderColor={colors.border}><text fg={colors.muted}>Enter send | Shift+Enter newline | Cmd/Ctrl+Enter hold | Ctrl+C stop | Ctrl+K commands</text></box>
  </box>;
}
function TuiComposer({ editor, session, focused, submit, run }: { editor: DraftEditor; session: Session; focused: boolean; submit: () => void; run: (operation: () => Promise<void>) => Promise<void> }) {
  const draft = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);
  const ref = useRef<TextareaRenderable>(null);
  const mirror = useRef<{ setting: boolean; text: string | null }>({ setting: false, text: null });
  useEffect(() => {
    if (ref.current && ref.current.plainText !== draft.text) {
      mirror.current.setting = true;
      try { ref.current.setText(draft.text); mirror.current.text = ref.current.plainText; }
      finally { mirror.current.setting = false; }
    }
  }, [draft.text]);
  return <box flexDirection="column" border borderColor={focused ? colors.accent : colors.border} padding={1} marginTop={1} flexShrink={0}>
    {/^\/budget\s+(?:set|profile|global)\b/.test(draft.text) && <text fg={colors.attention} height={3} flexShrink={0}>{BUDGET_WARNING} Input reservations use an explicit estimate-based policy, not a billing guarantee.</text>}
    <textarea ref={ref} focused={focused} initialValue={draft.text} height={4} maxHeight={8} textColor={colors.foreground} backgroundColor={colors.background}
      placeholder={session.status === "archived" ? "Archived. /restore returns to this session." : "Write a prompt. Enter sends; Shift+Enter newline. /help for commands."}
      keyBindings={[{ name: "return", action: "submit" }, { name: "return", shift: true, action: "newline" },
        { name: "kpenter", action: "submit" }, { name: "kpenter", shift: true, action: "newline" },
        { name: "j", ctrl: true, action: "newline" },
        { name: "return", ctrl: true, shift: true, action: "submit" }]} onSubmit={submit}
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
    {draft.text.startsWith("/") && !/\s/.test(draft.text) && <text fg={colors.accent}>{slashCommands.filter((entry) => entry.name.startsWith(draft.text.slice(1))).slice(0, 4).map((entry) => `/${entry.name}`).join("  ")}</text>}
  </box>;
}
function SettingsTextEditor({ value, change, submit }: { value: string; change: (value: string) => void; submit: (value: string) => void }) {
  const ref = useRef<TextareaRenderable>(null);
  return <box flexGrow={1} minHeight={0} border borderColor={colors.border} padding={1}>
    <textarea ref={ref} initialValue={value} focused flexGrow={1} textColor={colors.foreground} backgroundColor={colors.background}
      keyBindings={[{ name: "return", ctrl: true, action: "submit" }]} onSubmit={() => submit(ref.current?.plainText ?? value)}
      onContentChange={() => { const text = ref.current?.plainText ?? ""; if (text !== value) change(text); }} />
  </box>;
}
