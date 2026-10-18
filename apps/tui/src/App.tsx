/** @jsxImportSource @opentui/react */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { stripVTControlCharacters } from "node:util";
import { useMoguri } from "../../../packages/client/src/react.ts";
import { DraftEditor } from "../../../packages/client/src/draft.ts";
import type { MoguriClient } from "../../../packages/client/src/index.ts";
import type { Command, Controls, Session } from "../../../packages/protocol/src/index.ts";

const colors = { background: "#172027", panel: "#1e2a32", foreground: "#dce4e8", muted: "#a1b0ba", accent: "#99c4ae", border: "#40515d", error: "#f0b3a7", attention: "#e8c785" };
const safe = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const label = (session: Session) => session.messages.find((message) => message.role === "user")?.text.split("\n")[0]?.slice(0, 44) || session.title;
type Mode = "compose" | "project" | "sessions" | "models" | "queue" | "trace" | "help" | "approval";

export function TuiApp({ client, onQuit, initialSessionId }: { client: MoguriClient; onQuit?: () => void; initialSessionId?: string }) {
  const { snapshot, status, error, events } = useMoguri(client);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [mode, setMode] = useState<Mode>("compose");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const editors = useRef(new Map<string, DraftEditor>());
  const session = snapshot?.sessions.find((session) => session.id === selectedId);
  const project = snapshot?.projects.find((project) => project.id === session?.projectId);
  const editor = React.useMemo(() => {
    if (!session) return null;
    let value = editors.current.get(session.id);
    if (!value) { value = new DraftEditor(client, session.id, session.draft); editors.current.set(session.id, value); }
    return value;
  }, [client, session?.id]);
  useEffect(() => {
    if (!selectedId && snapshot?.sessions.length) setSelectedId(snapshot.sessions.find((session) => session.status !== "archived")?.id ?? snapshot.sessions[0]!.id);
  }, [snapshot, selectedId]);
  useEffect(() => { if (session && editor) editor.receive(session.draft); }, [session?.draft.revision, editor]);
  const perform = async (action: () => Promise<unknown>) => {
    setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Operation failed. The draft is preserved."); }
  };
  const command = (command: Command) => perform(() => client.command(command));
  const chooseSession = async (id: string) => { await editor?.flush(); setSelectedId(id); setMode("compose"); };
  const newSession = async () => {
    await editor?.flush();
    const currentProject = project ?? snapshot?.projects[0];
    if (!currentProject) { setMode("project"); return; }
    const result = await client.command({ type: "session.create", projectId: currentProject.id });
    setSelectedId(result.id!); setMode("compose"); setShowArchived(false);
  };
  const openProject = async (path: string) => {
    await editor?.flush();
    const project = await client.command({ type: "project.add", path });
    const created = await client.command({ type: "session.create", projectId: project.id! });
    setSelectedId(created.id!); setMode("compose"); setShowArchived(false);
  };
  const configure = (controls: Controls) => {
    if (!session) throw new Error("Create a session first.");
    return client.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls });
  };
  const submit = async (text: string) => {
    if (!session || !editor) throw new Error("Open a project with Ctrl+O, then create a session.");
    const firstSpace = text.indexOf(" ");
    const name = (firstSpace < 0 ? text : text.slice(0, firstSpace)).trim();
    const argument = firstSpace < 0 ? "" : text.slice(firstSpace + 1).trim();
    if (!text.startsWith("/") || name === "/steer" || name === "/interrupt") {
      if (name === "/steer" || name === "/interrupt") editor.edit(argument);
      await editor.send(name === "/steer" ? "steer" : name === "/interrupt" ? "interrupt" : "queue");
      return;
    }
    switch (name) {
      case "/connect": await client.command({ type: "provider.login" }); break;
      case "/disconnect": await client.command({ type: "provider.logout" }); break;
      case "/cancel-login": await client.command({ type: "provider.cancel" }); break;
      case "/models": setMode("models"); break;
      case "/model": await configure({ ...session.controls, modelId: argument }); break;
      case "/env":
        if (!["Local", "Sandbox", "Remote"].includes(argument)) throw new Error("Use /env Local, Sandbox, or Remote. Unready backends are rejected.");
        await configure({ ...session.controls, env: argument as Controls["env"] }); break;
      case "/autonomy":
        if (!["Manual", "Guided", "Autopilot", "Autopilot Max"].includes(argument)) throw new Error("Choose a documented autonomy level. Only Manual is available.");
        await configure({ ...session.controls, autonomy: argument as Controls["autonomy"] }); break;
      case "/budget":
        if (argument !== "Unlimited") throw new Error("Only /budget Unlimited is enforceable in this checkpoint. No cap was applied.");
        await configure({ ...session.controls, budget: { kind: "unlimited" } }); break;
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
      case "/new": await newSession(); break;
      case "/open": await openProject(argument); break;
      case "/sessions": setMode("sessions"); break;
      case "/trace": setMode("trace"); break;
      case "/details": setDetailed((value) => !value); break;
      case "/help": setMode("help"); break;
      default: throw new Error("Unknown slash command. Use /help. Ordinary @, ^, :, # and ! text stays literal.");
    }
    editor.edit(""); await editor.flush();
  };
  useKeyboard((key) => {
    if (key.name === "escape") { setMode("compose"); return; }
    if (!key.ctrl) return;
    if (["q", "c", "o", "n", "l", "m", "p", "k", "b", "y", "d", "a", "r", "s", "v"].includes(key.name)) key.preventDefault();
    if (key.name === "q") void perform(async () => {
      for (const editor of editors.current.values()) await editor.flush();
      for (const editor of editors.current.values()) editor.dispose();
      client.disconnect();
      if (onQuit) onQuit(); else renderer.destroy();
    });
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
    else if ((key.name === "y" || key.name === "d") && session?.pendingApproval) void command({
      type: "approval.respond", sessionId: session.id, approvalId: session.pendingApproval.id, allow: key.name === "y",
    });
  });
  const options = snapshot?.sessions.filter((item) => (item.status === "archived") === showArchived).map((item) => ({
    name: safe(label(item)), description: `${snapshot.projects.find((project) => project.id === item.projectId)?.name ?? "Project"} / ${item.status}`, value: item.id,
  })) ?? [];
  return <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
    <box height={3} paddingLeft={2} paddingRight={2} alignItems="center" flexDirection="row" border={["bottom"]} borderColor={colors.border}>
      <text fg={colors.accent}><strong>moguri</strong></text><text fg={colors.muted}>  /  {safe(project?.name ?? "local workspace")}  /  {status}</text>
    </box>
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {width >= 100 && <box width={26} border={["right"]} borderColor={colors.border} padding={1} flexDirection="column">
        <text fg={colors.muted}>{showArchived ? "ARCHIVED" : "SESSIONS"}  Ctrl+P</text>
        {options.length ? <select flexGrow={1} options={options} focused={mode === "sessions"} selectedBackgroundColor={colors.panel} selectedTextColor={colors.accent} textColor={colors.foreground} descriptionColor={colors.muted}
          onSelect={(_, option) => { if (option?.value) void perform(() => chooseSession(String(option.value))); }} /> : <text fg={colors.muted}>{"\nNo sessions yet.\n\nCtrl+O open project\nCtrl+L connect Copilot"}</text>}
        <text fg={colors.muted}>{"Ctrl+N new session\nCtrl+A active/archive\nCtrl+Q save and leave"}</text>
      </box>}
      <box flexGrow={1} minWidth={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
        {mode === "project" ? <box flexDirection="column" paddingTop={2} gap={1}><text fg={colors.accent}>Open a local project directory</text><text fg={colors.muted}>Local execution is not sandboxed. Every tool action needs approval.</text>
          <input focused value={projectPath} onInput={setProjectPath} placeholder="/absolute/path/to/project" onSubmit={() => void perform(() => openProject(projectPath))} /></box> :
        mode === "models" ? <box flexGrow={1} flexDirection="column" paddingTop={1}><text fg={colors.accent}>Select a GitHub Copilot model</text>
          {snapshot?.provider.models.length ? <select focused flexGrow={1} options={snapshot.provider.models.map((model) => ({ name: model.name, description: `${model.contextWindow} context tokens / GitHub Copilot`, value: model.id }))}
            onSelect={(_, option) => { if (!session) { setNotice("Open a project with Ctrl+O before choosing a session model."); return; } if (option?.value) void perform(async () => { await configure({ ...session.controls, modelId: String(option.value) }); setMode("compose"); }); }} /> :
            <text fg={colors.muted}>No authenticated models. Ctrl+L starts GitHub Copilot sign-in.</text>}
          <text fg={colors.muted}>kupo is unavailable until its routing and isolation contracts are validated.</text></box> :
        mode === "sessions" && width < 100 ? <select focused flexGrow={1} options={options} onSelect={(_, option) => { if (option?.value) void perform(() => chooseSession(String(option.value))); }} /> :
        mode === "help" ? <scrollbox flexGrow={1} focused><text fg={colors.foreground}>{`Commands

Ctrl+O open project    Ctrl+N new session    Ctrl+P sessions
Ctrl+L Copilot login   Ctrl+M model picker   Ctrl+Enter send/queue
Ctrl+C stop turn      Ctrl+Y approve tool   Ctrl+D deny tool
Ctrl+B event trace    Ctrl+A archive view   Ctrl+Q save and leave
Ctrl+R reload draft  Ctrl+S save/keep my draft after a conflict
Ctrl+V scroll full approval arguments
Esc composer

/connect | /cancel-login | /disconnect | /models | /model ID
/env Local | /autonomy Manual | /budget Unlimited
/attach project/path.txt  (explicit @ project-file snapshot)
/detach path-or-ID removes an attached snapshot
/steer text | /interrupt text | /stop | /resume
/queue | /edit ID text | /remove ID | /reorder ID ID ...
/queue-turn ID converts an unapplied steer into a new turn
/archive | /restore | /new | /open PATH | /sessions
/trace | /details | /reload-draft | /keep-draft
/policy all | /policy protected

Unsupported Sandbox, Remote, kupo, other autonomy levels and finite
budgets fail closed. Folder, GitHub/session and image attachments
are not implemented. Bare attachment prefixes stay literal.

Protected policy blocks all new Local turns in this checkpoint.
Only turns already running at the policy boundary may finish.

Copilot uses pi-ai's third-party device flow. A subscription and
account authorization are required. Sign-in may enable account
model policies. Moguri is not an official Copilot partner.
Credentials stay in Moguri's profile-scoped OS keychain.`}</text></scrollbox> :
        mode === "trace" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Recent events (last 200 received)</text>{events.filter((event) => !session || event.session_id === session.id).map((event) => <text key={event.id} fg={colors.muted}>{safe(`#${event.seq} ${event.event_type}\n${JSON.stringify(event.payload)}\n`)}</text>)}</scrollbox> :
        mode === "queue" ? <scrollbox flexGrow={1} focused><text fg={colors.accent}>Unclaimed messages. /edit, /remove, /reorder and /resume use revision checks.</text>{session?.queue.map((item) => <text key={item.id} fg={colors.foreground}>{safe(`\n${item.id} [${item.delivery}]\n${item.text}\n`)}</text>)}</scrollbox> :
          <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom">
            {!session?.messages.length && <box flexDirection="column" paddingTop={3} paddingBottom={3} gap={1}><text fg={colors.accent}><strong>What are we working on?</strong></text><text fg={colors.muted}>{session ? "Choose a model with Ctrl+M, then write a prompt below.\nYou approve each tool before it runs." : "Ctrl+O opens a project. Ctrl+L connects GitHub Copilot.\nSessions and drafts are shared with the desktop app."}</text></box>}
            {session?.messages.slice(detailed ? 0 : -150).map((message) => <box key={message.id} flexDirection="column" paddingTop={1} paddingBottom={1}>
              <text fg={message.role === "user" ? colors.accent : message.role === "notice" ? colors.attention : colors.muted}><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Moguri" : message.role === "tool" ? message.toolCalls?.[0]?.name ?? "Tool" : "Session"}</strong>{message.outcome ? ` / ${message.outcome}` : ""}</text>
              <text fg={colors.foreground}>{safe((detailed ? message.text : message.text.slice(-4000)) || (message.toolCalls?.length ? "Requesting tool access." : "Working..."))}</text>
              {detailed && message.reasoning && <text fg={colors.muted}>{safe(`Provider-exposed reasoning:\n${message.reasoning}`)}</text>}
            </box>)}
          </scrollbox>}
        {snapshot?.provider.login && <box flexDirection="column" border borderColor={colors.accent} padding={1}>
          <text fg={colors.accent}>GitHub Copilot sign-in: {snapshot.provider.login.code}</text><text fg={colors.foreground}>{snapshot.provider.login.url}</text><text fg={colors.muted}>Authorize in your browser. /cancel-login cancels. Account model policies may be enabled.</text>
        </box>}
        {snapshot?.provider.diagnostic && <text fg={colors.attention}>{safe(snapshot.provider.diagnostic)}</text>}
        {session?.pendingApproval && <box flexDirection="column" border borderColor={colors.attention} padding={1} height={10} flexShrink={0}>
          <text fg={colors.attention}><strong>Approval required: {session.pendingApproval.call.name}</strong></text>
          <scrollbox flexGrow={1} focused={mode === "approval"}><text fg={colors.foreground}>{safe(JSON.stringify(session.pendingApproval.call.arguments, null, 2))}</text></scrollbox>
          <text fg={colors.attention}>{session.pendingApproval.call.name === "run_command" ? "Unsandboxed Local. " : "Project access. "}Ctrl+Y approve | Ctrl+D deny | Ctrl+V full args</text>
        </box>}
        {session?.localFinishing && <text fg={colors.attention}>Local finishing: new Local turns are blocked by policy.</text>}
        {notice || error ? <text fg={colors.error}>{safe(notice || error || "")}</text> : null}
        {session && editor && <TuiComposer key={session.id} editor={editor} session={session} focused={mode === "compose" && !session.pendingApproval}
          submit={() => void perform(() => submit(editor.getState().text))} />}
        <box height={4} flexShrink={0} flexDirection="column">
          <text fg={colors.muted}>{session ? `Env ${session.controls.env} | Model ${session.controls.modelId ?? "not set (Ctrl+M)"}` : "Env Local | Model not set"}</text>
          <text fg={colors.muted}>{`Autonomy level ${session?.controls.autonomy ?? "Manual"} | Budget Unlimited`}</text>
          <text fg={colors.muted}>{session ? `${session.status} | ${session.queue.length} queued | ${session.usage.length} model calls | cost unavailable` : "Factory defaults. Ctrl+K commands."}</text>
        </box>
      </box>
    </box>
    <box height={2} paddingLeft={2} border={["top"]} borderColor={colors.border}><text fg={colors.muted}>Ctrl+Enter send  Ctrl+C stop  Ctrl+L Copilot  Ctrl+M model  Ctrl+K commands  Ctrl+Q leave</text></box>
  </box>;
}
function TuiComposer({ editor, session, focused, submit }: { editor: DraftEditor; session: Session; focused: boolean; submit: () => void }) {
  const draft = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);
  const ref = useRef<TextareaRenderable>(null);
  useEffect(() => {
    if (ref.current && ref.current.plainText !== draft.text) ref.current.setText(draft.text);
  }, [draft.text]);
  return <box flexDirection="column" border borderColor={focused ? colors.accent : colors.border} padding={1} marginTop={1} flexShrink={0}>
    <textarea ref={ref} focused={focused} initialValue={draft.text} height={4} maxHeight={8} textColor={colors.foreground} backgroundColor={colors.background}
      placeholder={session.status === "archived" ? "Archived. Use /restore from the command surface." : "Write a prompt. Ctrl+Enter sends. /help for commands."}
      keyBindings={[{ name: "return", ctrl: true, action: "submit" }]} onSubmit={submit}
      onContentChange={() => { const text = ref.current?.plainText ?? ""; if (text !== editor.getState().text) editor.edit(text); }} />
    {draft.attachments.length > 0 && <text fg={colors.accent}>{draft.attachments.map((attachment) => `@${attachment.path}`).join("  ")}</text>}
    <text fg={draft.error ? colors.error : colors.muted}>{draft.error ?? (draft.saving ? "Saving draft..." : draft.dirty ? "Unsent edits" : "Draft saved")}</text>
  </box>;
}
