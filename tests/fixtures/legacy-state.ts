import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import type { startService } from "../../apps/service/src/server.ts";
import { PROTOCOL_VERSION } from "../../packages/protocol/src/index.ts";

export function assertCurrentSchema(store: { db: DatabaseSync }): void {
  assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
}
export function appendLegacyAutopilot(service: Awaited<ReturnType<typeof startService>>, sessionId: string): void {
  const session = service.controller.snapshot().sessions.find((value) => value.id === sessionId);
  if (!session || session.controls.automaticApprovals !== undefined) throw new Error("Generate an original bounded session; never strip actual automatic-approval consent.");
  service.store.commit([{ event_type: "session.configured", profile_id: service.controller.snapshot().profileId,
    project_id: session.projectId, session_id: session.id, payload: { controls: { ...session.controls, autonomy: "Autopilot" } } }]);
  service.controller.refreshProfile();
}
export function removePost44FixtureMarkers(db: DatabaseSync): void {
  const future = db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type') IN ('candidate.owner_bound','candidate.cleanup_recorded','candidate.usage_retained','model.selection_remembered','session.pr_observed','skill.used','sandbox.setup_recorded','task.plan_updated','notification.sound_saved','notification.sound_removed','application.configured','application.storage_recorded','application.update_recorded')").get();
  if (Number(future?.count)) throw new Error("Generate genuine pre-settings history before relabeling an additive-marker fixture. New native intent or sound grants cannot become old data.");
  db.exec("DELETE FROM retention_metadata WHERE id IN ('chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema','session_navigation_schema','workspace_experience_schema','lean_tooling_schema','lean_tooling_convergence_schema','candidate_retention_schema','browser_control_schema','model_defaults_schema','session_indicators_schema','desktop_interaction_schema','managed_sandbox_schema','session_interactions_schema','settings_preferences_schema','client_voice_capture_schema','notification_sound_schema','application_preferences_schema','state_location_schema','private_update_schema')");
}
export function retainedCiphertextRows(db: DatabaseSync) {
  return ["events", "retention_keys", "retention_forgotten", "blob_payloads", "receipts", "memory_scopes", "memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()] as const);
}
export async function writeLegacyState(service: Awaited<ReturnType<typeof startService>>, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60, lineage: "main" | "desktop" = "main"): Promise<void> {
  const events = service.store.db.isOpen ? service.store.events() : service.controller.events(0);
  if (events.some((event) => event.event_type === "session.home_bound" || event.event_type === "chat.writer_recorded" ||
    event.event_type === "session.created" && event.payload.homeRoot)) {
    throw new Error("Generate genuine root-less pre-Home chat history; immutable Home bindings and independent writer ownership cannot become older state.");
  }
  if (events.some((event) => event.event_type === "settings.updated" && Object.hasOwn(event.payload.settings, "modelPreferences"))) {
    throw new Error("Generate genuine pre-availability history; actual provider/model switches and source choices cannot become older state.");
  }
  if (events.some((event) => event.event_type === "session.continue_work_chosen" ||
    event.event_type === "issue.saved" && (event.payload.issue.order !== undefined || event.payload.issue.github) ||
    event.event_type === "board.saved" && (event.payload.board.githubSync || event.payload.board.githubSource))) {
    throw new Error("Generate genuine pre-Kanban-interaction history; actual routing answers and card ordering cannot become older state.");
  }
  if (events.some((event) => event.event_type === "project.work_recorded" || event.event_type === "pricing.catalog_recorded" ||
    event.event_type === "session.created" && event.payload.purpose ||
    event.event_type === "session.organized" && event.payload.changes.workItemId !== undefined ||
    event.event_type === "board.saved" && event.payload.board.kanban ||
    event.event_type === "budget.recorded" && event.payload.entry.rate?.source === "provider-api-equivalent" ||
    event.event_type === "settings.updated" && event.payload.settings.budgets.useProviderRatesForLimits)) {
    throw new Error("Generate genuine pre-Kanban/pricing history; task delegation, board preferences and API-equivalent price consent cannot become older state.");
  }
  if (events.some((event) => (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.automaticApprovals !== undefined ||
    event.event_type === "session.created" && (event.payload.workItemUrl || event.payload.githubSource) || event.event_type === "session.organized" && event.payload.changes.workItemUrl !== undefined ||
    event.event_type === "tool.decided" && event.payload.actor === "autonomy" ||
    event.event_type === "settings.updated" && event.payload.settings.permissions.remembered?.length)) {
    throw new Error("Generate genuine pre-workflow history; automatic approval consent, remembered grants and GitHub issue bindings cannot become older state.");
  }
  if (events.some((event) => event.event_type === "routing.response_selected" ||
    event.event_type === "routing.started" && event.payload.routing.policy.workflow === "auto" ||
    event.event_type === "model.started" && event.payload.kupoPhase ||
    event.event_type === "model.completed" && event.payload.kupo)) throw new Error("Generate genuine pre-automatic-Kupo history; actual routing ownership and selected responses cannot become older state.");
  if (version < 60 && events.some((event) => event.event_type === "settings.updated" && event.payload.settings.interactions?.confirmSessionDetach === false)) throw new Error("Generate genuine pre-detach-preference history; remembered detachment choices cannot become older state.");
  if (version < 59 && events.some((event) => event.event_type === "settings.updated" && event.payload.settings.skillSources?.length)) throw new Error("Generate genuine pre-gateway history; reviewed skill-source authority cannot become older state.");
  const desktop = lineage === "desktop";
  if (events.some((event) => event.event_type.startsWith("coordination.") ||
    event.event_type === "tool.completed" && event.payload.rawDigest ||
    event.event_type === "session.created" && (event.payload.parentSnapshotDigest || event.payload.coordinationParentId))) throw new Error("Generate genuine pre-tooling history; retained source grants and coordination ownership cannot become older data.");
  if (desktop && (version < 44 || version > 46)) throw new Error("The divergent desktop lineage used only schemas 44 through 46.");
  if (version < 55 && events.some((event) => event.event_type === "model.selection_remembered")) throw new Error("Generate genuine pre-model-default history; explicit remembered selections cannot become older metadata.");
  if (version < 54 && events.some((event) => event.event_type === "session.pr_observed" ||
    event.event_type === "issue.saved" && typeof event.payload.issue.pullRequest?.draft === "boolean")) throw new Error("Generate genuine pre-indicator history; verified session PR/draft observations cannot become older metadata.");
  if (version < 53 && (!desktop || version < 45) && events.some((event) => event.event_type === "skill.used")) throw new Error("Generate genuine pre-activity history; retained skill selection cannot become main-line legacy data.");
  if (!desktop && version < 53 && events.some((event) => {
    if (event.event_type === "settings.updated" && event.payload.settings.interactions &&
      (!event.payload.settings.interactions.confirmSessionAttachments || !event.payload.settings.interactions.confirmTerminalClose)) return true;
    const attachments = event.event_type === "draft.saved" ? event.payload.attachments : event.event_type === "queue.edited" ? event.payload.attachments ?? [] :
      event.event_type === "queue.enqueued" || event.event_type === "turn.started" || event.event_type === "steer.applied" ? event.payload.item.attachments : [];
    return attachments.some((attachment) => attachment.kind === "github_file");
  })) throw new Error("Generate genuine main-line legacy history; desktop confirmation and GitHub-file semantics cannot become older data.");
  if (version < 52 && events.some((event) => event.event_type === "sandbox.setup_recorded" ||
    event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation ||
    event.event_type === "sandbox.execution_recorded" && event.payload.execution.networkScope ||
    event.event_type === "settings.updated" && event.payload.settings.sandboxManagement?.enabled)) {
    throw new Error("Generate pre-managed-Sandbox history; actual setup approvals, automatic sources and provider scopes cannot become old grants.");
  }
  if (version < 51 && events.some((event) => event.event_type === "task.plan_updated" ||
    event.event_type === "turn.stop_requested" && event.payload.holdQueue ||
    !desktop && event.event_type === "session.organized" && event.payload.changes.order !== undefined ||
    event.event_type === "question.answered" && event.payload.answer.other ||
    event.event_type === "settings.updated" && (event.payload.settings.retention.confirmArchive === false || event.payload.settings.retention.confirmDelete === false))) {
    throw new Error("Generate pre-interaction history; never relabel actual task plans, session order, Other answers or remembered confirmations as an older schema.");
  }
  if (version < 47 && events.some((event) => {
    if (event.event_type === "notification.sound_saved" || event.event_type === "notification.sound_removed") return true;
    if (event.event_type !== "settings.updated") return false;
    const value = event.payload.settings.notifications;
    return value.soundWhileFocused || [value.needsInputSound, value.completedSound].some((choice) => choice && (!choice.enabled || choice.id !== "default"));
  })) throw new Error("Generate pre-sound history; never relabel retained audio grants or actual sound choices as an older schema.");
  if (version < 46 && events.some((event) => {
    if (event.event_type === "job.started" && event.payload.job.kind === "voice.capture") return true;
    if (event.event_type !== "settings.updated") return false;
    const value = event.payload.settings;
    return value.voice.inputDeviceId !== undefined && value.voice.inputDeviceId !== "default" || value.voice.pushToTalk ||
      value.voice.shortcut !== undefined && value.voice.shortcut !== "Control+Space" ||
      value.shortcuts && (value.shortcuts.commands !== "Primary+KeyK" || value.shortcuts.terminalCopy !== "Primary+Shift+KeyC");
  })) throw new Error("Generate pre-capture history; never relabel actual browser capture or remapped device/shortcut ownership as an older schema.");
  if (version < 45 && events.some((event) => {
    if (event.event_type === "session.created" || event.event_type === "session.configured") return event.payload.controls.verbosity !== undefined;
    if (event.event_type === "project.configured") return Object.keys(event.payload.configuration.values.guidance ?? {}).length > 0 || event.payload.configuration.values.defaults?.verbosity !== undefined;
    if (event.event_type !== "settings.updated") return false;
    const value = event.payload.settings;
    return Object.keys(value.guidance ?? {}).length > 0 || value.startup.profile.verbosity !== undefined || value.startup.global.verbosity !== undefined ||
      value.appearance.palette !== undefined && value.appearance.palette !== "moguri" ||
      Object.keys(value.appearance.custom?.dark ?? {}).length > 0 || Object.keys(value.appearance.custom?.light ?? {}).length > 0 ||
      value.permissions.defaultDecision === "deny" || value.retention.archiveCompleted ||
      value.retention.archiveAfterDays !== undefined && value.retention.archiveAfterDays !== 7 ||
      value.lifecycle?.keepAwake || value.lifecycle && value.lifecycle.tailMinutes !== 5 ||
      value.integrations?.sql.enabled || value.integrations && value.integrations.sql.endpoint !== "http://127.0.0.1:9147";
  })) throw new Error("Generate pre-preference history; never relabel actual new guidance, palettes, controls, automation or native configuration as an older schema.");
  if (version < 44 && events.some((event) => event.event_type === "terminal.changed" && (event.payload.terminal.sessionId === null || event.payload.terminal.projectId === null) ||
    event.event_type === "job.started" && event.payload.job.projectClone)) throw new Error("Generate pre-entry history; never relabel independent consoles or original clone jobs as older state.");
  if (version < 42 && events.some((event) => event.event_type === "task.progress_reported")) throw new Error("Generate pre-progress history; never relabel actual model reports as older state.");
  if (version < 43 && events.some((event) => {
    if (event.event_type === "session.created") return Boolean(event.payload.documents?.length);
    const attachments = event.event_type === "draft.saved" ? event.payload.attachments : event.event_type === "queue.edited" ? event.payload.attachments ?? [] :
      event.event_type === "queue.enqueued" || event.event_type === "turn.started" || event.event_type === "steer.applied" ? event.payload.item.attachments : [];
    return attachments.some((attachment) => attachment.kind === "document");
  })) throw new Error("Generate pre-document history; never relabel new original/extracted grants as older state.");
  if (events.some((event) => event.event_type === "decision.recorded" || event.event_type === "steering.applied" ||
    event.event_type === "tool.decided" && event.payload.actor === "decision-provider" ||
    event.event_type === "question.answered" && event.payload.answer.actor === "decision-provider" ||
    event.event_type === "settings.updated" && event.payload.settings.decisions?.enabled)) throw new Error("Generate pre-decision history for a legacy fixture; do not relabel new automated actors, requests/results, actual charges or effects as an older schema.");
  if (version < 39 && events.some((event) => event.event_type === "winddown.recorded" || event.event_type === "job.started" && event.payload.job.winddownId ||
    event.event_type === "settings.updated" && event.payload.settings.winddown?.enabled)) throw new Error("Generate pre-wind-down history for a legacy fixture; do not relabel new finishing/accepted-work authority or effects as an older schema.");
  if (version < 38 && events.some((event) => event.event_type === "compound.recorded" || event.event_type === "candidate.saved" && event.payload.candidate.compoundOrigin ||
    event.event_type === "settings.updated" && event.payload.settings.kupo?.workflow === "compound" ||
    event.event_type === "turn.control_started" && event.payload.purpose === "compound.workflow")) throw new Error("Generate pre-public-compound history for a legacy fixture; do not relabel new role/test authority or candidate provenance as an older schema.");
  if (version < 37 && events.some((event) => event.event_type.startsWith("sandbox.") || event.event_type === "session.sandbox_bound")) throw new Error("Generate pre-native history for a legacy fixture; do not relabel new native staging/execution/retention semantics as an older schema.");
  if (version < 36 && events.some((event) => {
    if (event.event_type === "session.created") return event.payload.pasteFiles !== undefined;
    if (event.event_type === "queue.edited") return event.payload.attachments !== undefined;
    const attachments = event.event_type === "draft.saved" ? event.payload.attachments :
      event.event_type === "queue.enqueued" || event.event_type === "turn.started" || event.event_type === "steer.applied" ? event.payload.item.attachments : [];
    return attachments.some((attachment) => attachment.kind === "paste_file");
  })) throw new Error("Generate pre-paste-file history for a legacy fixture; do not relabel new file grants or queue-edit attachment semantics as an older schema.");
  if (version < 35 && events.some((event) => event.event_type === "role.sequence_recorded" && event.payload.sequence.inputVersion === 2)) throw new Error("Generate version-1 owned-role input for a legacy fixture; do not relabel new context/contract semantics as an older schema.");
  if (version < 33 && events.some((event) => event.event_type === "candidate.saved" && event.payload.candidate.roleOrigin)) throw new Error("Generate pre-role-proposal history for a legacy fixture; do not relabel future candidate model origin as an older schema.");
  if (version < 32 && events.some((event) => event.event_type === "role.sequence_recorded" || event.event_type === "turn.control_started" && event.payload.purpose === "role.sequence")) throw new Error("Generate pre-sequence history for a legacy fixture; do not relabel future role metadata as an older schema.");
  if (version < 31 && events.some((event) => event.event_type === "candidate.generation_recorded" ||
    event.event_type === "turn.control_started" && event.payload.purpose === "candidate.generate" ||
    event.event_type === "model.started" && event.payload.role === "draft" ||
    event.event_type === "budget.recorded" && event.payload.entry.role === "draft" ||
    event.event_type === "budget.plan_recorded" && event.payload.plan.role === "draft")) throw new Error("Generate pre-generation history for a legacy fixture; do not relabel future model generations/draft roles as an older schema.");
  if (events.some((event) => event.event_type === "candidate.owner_bound" || event.event_type === "candidate.cleanup_recorded" || event.event_type === "candidate.usage_retained" ||
    event.event_type === "model.completed" && event.payload.candidateGenerationId ||
    event.event_type === "artifact.deleted" && event.payload.candidateIntents)) throw new Error("Generate genuine pre-candidate-retention history; original ownership, cleanup intents, output grants and deleted-command tombstones cannot be relabeled as older state.");
  if (version >= 4) {
    const path = service.store.path; await service.close();
    const db = new DatabaseSync(path);
    try {
      db.exec("DELETE FROM retention_metadata WHERE id IN ('chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema')");
      if (version < 50 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='application.update_recorded'").get()?.count)) throw new Error("Generate pre-update history; never relabel actual download, installer or retained restart identity as an older schema.");
      if (version < 49 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='application.storage_recorded'").get()?.count)) throw new Error("Generate pre-relocation history; never relabel actual whole-store copy/root authority as an older schema.");
      if (version < 48 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='application.configured'").get()?.count)) throw new Error("Generate pre-application-preference history; never relabel actual root-owned configuration as an older schema.");
      if (version < 32 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='role.sequence_recorded'").get()?.count)) throw new Error("Generate pre-sequence history for a legacy fixture; do not relabel future role metadata as an older schema.");
      if (version < 31 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='candidate.generation_recorded'").get()?.count)) throw new Error("Generate pre-generation history for a legacy fixture; do not relabel future model generations as an older schema.");
      if (version < 30 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='budget.plan_recorded'").get()?.count)) throw new Error("Generate pre-planning history for a legacy fixture; do not relabel future budget plans as an older schema.");
      if (version < 29 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='candidate.saved'").get()?.count)) throw new Error("Generate pre-candidate history for a legacy fixture; do not relabel future events as an older schema.");
      if (version >= 14) {
        db.exec(`BEGIN IMMEDIATE;
          ${version < 60 ? "DELETE FROM retention_metadata WHERE id='session_navigation_schema';" : ""}
          ${version < 59 ? "DELETE FROM retention_metadata WHERE id='workspace_experience_schema';" : ""}
          ${version < 58 ? "DELETE FROM retention_metadata WHERE id IN ('lean_tooling_schema','lean_tooling_convergence_schema');" : ""}
          ${version < 57 ? "DELETE FROM retention_metadata WHERE id='candidate_retention_schema';" : ""}
          ${version < 56 ? "DELETE FROM retention_metadata WHERE id='browser_control_schema';" : ""}
          ${version < 55 ? "DELETE FROM retention_metadata WHERE id='model_defaults_schema';" : ""}
          ${version < 54 ? "DELETE FROM retention_metadata WHERE id='session_indicators_schema';" : ""}
          ${!desktop && version < 53 ? "DELETE FROM retention_metadata WHERE id='desktop_interaction_schema';" : ""}
          ${desktop || version < 52 ? "DELETE FROM retention_metadata WHERE id='managed_sandbox_schema';" : ""}
          ${desktop || version < 51 ? "DELETE FROM retention_metadata WHERE id='session_interactions_schema';" : ""}
          ${desktop || version < 50 ? "DELETE FROM retention_metadata WHERE id='private_update_schema';" : ""}
          ${desktop || version < 49 ? "DELETE FROM retention_metadata WHERE id='state_location_schema';" : ""}
          ${desktop || version < 48 ? "DELETE FROM retention_metadata WHERE id='application_preferences_schema';" : ""}
          ${desktop || version < 47 ? "DELETE FROM retention_metadata WHERE id='notification_sound_schema';" : ""}
          ${desktop || version < 46 ? "DELETE FROM retention_metadata WHERE id='client_voice_capture_schema';" : ""}
          ${desktop || version < 45 ? "DELETE FROM retention_metadata WHERE id='settings_preferences_schema';" : ""}
          ${desktop || version < 44 ? "DELETE FROM retention_metadata WHERE id='workspace_entry_schema';" : ""}
          ${version < 43 ? "DELETE FROM retention_metadata WHERE id='document_attachment_schema';" : ""}
          ${version < 42 ? "DELETE FROM retention_metadata WHERE id='task_progress_schema';" : ""}
          ${version < 40 ? "DELETE FROM retention_metadata WHERE id='owned_decision_schema';" : ""}
          ${version < 39 ? "DELETE FROM retention_metadata WHERE id='budget_winddown_schema';" : ""}
          ${version < 38 ? "DELETE FROM retention_metadata WHERE id='compound_workflow_schema';" : ""}
          ${version < 37 ? "DELETE FROM retention_metadata WHERE id='native_execution_schema';" : ""}
          ${version < 36 ? "DELETE FROM retention_metadata WHERE id='paste_file_schema';" : ""}
          ${version < 35 ? "DELETE FROM retention_metadata WHERE id='owned_role_contract_schema';" : ""}
          ${version < 34 ? "DELETE FROM retention_metadata WHERE id='model_evidence_schema';" : ""}
          ${version < 33 ? "DELETE FROM retention_metadata WHERE id='candidate_role_schema';" : ""}
          ${version < 32 ? "DELETE FROM retention_metadata WHERE id='role_sequence_schema';" : ""}
          ${version < 31 ? "DELETE FROM retention_metadata WHERE id='candidate_generation_schema';" : ""}
          ${version < 30 ? "DELETE FROM retention_metadata WHERE id='budget_planning_schema';" : ""}
          ${version < 29 ? "DELETE FROM retention_metadata WHERE id='candidate_execution_schema';" : ""}
          ${version < 28 ? "DELETE FROM retention_metadata WHERE id='candidate_workflow_schema';" : ""}
          ${version < 27 ? "DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id='remote_memory_schema';" : ""}
          ${version < 26 ? "DELETE FROM retention_metadata WHERE id='remote_repository_schema';" : ""}
          ${version < 25 ? "DELETE FROM retention_metadata WHERE id='remote_terminal_schema';" : ""}
          ${version < 24 ? "DELETE FROM retention_metadata WHERE id='remote_mcp_schema';" : ""}
          ${version < 23 ? "DELETE FROM retention_metadata WHERE id='terminal_ownership_schema';" : ""}
          ${version < 22 ? "DELETE FROM retention_metadata WHERE id='repository_attribution_schema';" : ""}
          ${version < 21 ? "DELETE FROM retention_metadata WHERE id='operation_metrics_schema';" : ""}
          ${version < 20 ? "DELETE FROM retention_metadata WHERE id='remote_plan_save_schema';" : ""}
          ${version < 19 ? "DELETE FROM retention_metadata WHERE id='context_compaction_schema';" : ""}
          ${version < 18 ? "DELETE FROM retention_metadata WHERE id='stream_telemetry_schema';" : ""}
          ${version < 17 ? "DELETE FROM retention_metadata WHERE id='remote_workspace_read_schema';" : ""}
          ${version < 16 ? "DELETE FROM retention_metadata WHERE id='single_routing_schema';" : ""}
          ${version === 14 ? "DELETE FROM retention_metadata WHERE id='guided_advice_schema';" : ""}
          PRAGMA user_version=${version}; COMMIT;`);
        return;
      }
      if (Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.profile_id') NOT IN ('default','_global')").get()?.count)) throw new Error("Generate Default-only legacy fixtures without dropping another user profile.");
      db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('automatic_kupo_schema','session_navigation_schema','workspace_experience_schema','lean_tooling_schema','lean_tooling_convergence_schema','candidate_retention_schema','browser_control_schema','model_defaults_schema','session_indicators_schema','desktop_interaction_schema','managed_sandbox_schema','session_interactions_schema','private_update_schema','state_location_schema','application_preferences_schema','notification_sound_schema','client_voice_capture_schema','settings_preferences_schema','workspace_entry_schema','document_attachment_schema','task_progress_schema','remote_memory_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema','owned_decision_schema'); DROP TRIGGER events_no_delete;
        DELETE FROM events WHERE json_extract(data,'$.profile_id')='_global';
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`);
      for (const table of ["blob_payloads", "retention_keys", "retention_forgotten"]) db.prepare(`DELETE FROM ${table} WHERE scope='profile/_global' OR scope GLOB 'profile/_global/*'`).run();
      if (db.prepare("PRAGMA table_info(receipts)").all().some((column) => column.name === "profile_id")) {
        if (Number(db.prepare("SELECT count(*) AS count FROM receipts WHERE profile_id<>'default'").get()?.count)) throw new Error("A legacy fixture cannot discard scoped command receipts.");
        db.exec(`CREATE TABLE receipts_legacy(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
          INSERT INTO receipts_legacy SELECT id,digest,result FROM receipts WHERE profile_id='default';
          DROP TABLE receipts; ALTER TABLE receipts_legacy RENAME TO receipts;`);
      }
      db.exec(`DELETE FROM retention_metadata WHERE id IN ('profile_scope_schema','guided_advice_schema','single_routing_schema','remote_workspace_read_schema','stream_telemetry_schema','context_compaction_schema','remote_plan_save_schema','operation_metrics_schema','repository_attribution_schema','terminal_ownership_schema','remote_mcp_schema','remote_terminal_schema','remote_repository_schema');
        ${version < 13 ? "DELETE FROM retention_metadata WHERE id='budget_ledger_schema';" : ""}
        ${version < 12 ? "DELETE FROM retention_metadata WHERE id='artifact_repository_schema';" : ""}
        ${version < 11 ? "DELETE FROM retention_metadata WHERE id='structured_question_schema';" : ""}
        ${version < 10 ? "DELETE FROM retention_metadata WHERE id='retained_artifact_schema';" : ""}
        ${version < 9 ? "DELETE FROM retention_metadata WHERE id='managed_workspace_schema';" : ""}
        ${version < 8 ? "DELETE FROM retention_metadata WHERE id='execution_transport_schema';" : ""}
        ${version < 7 ? "DELETE FROM retention_metadata WHERE id='runtime_foundation_schema';" : ""}
        ${version < 6 ? "DELETE FROM retention_metadata WHERE id='engagement_schema';" : ""}
        ${version === 4 ? "DELETE FROM retention_metadata WHERE id='model_controls_schema';" : ""}
        PRAGMA user_version=${version}; COMMIT;`);
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    finally { db.close(); }
    return;
  }
  if (events.some((event) => event.event_type === "budget.plan_recorded")) throw new Error("Generate pre-planning history for a legacy fixture; do not relabel future budget plans as an older schema.");
  if (events.some((event) => event.event_type === "candidate.saved")) throw new Error("Generate pre-candidate history for a legacy fixture; do not relabel future events as an older schema.");
  const blobs = service.store.db.prepare("SELECT DISTINCT digest FROM blob_payloads").all().map((row) => [String(row.digest), service.store.blob(String(row.digest))] as const);
  const path = service.store.path;
  await service.close();
  const db = new DatabaseSync(path);
  try {
    db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DROP TABLE events; DROP TABLE blob_payloads; DROP TABLE retention_keys; DROP TABLE retention_forgotten; DROP TABLE retention_metadata;
      CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE blobs(digest TEXT PRIMARY KEY,content TEXT NOT NULL);`);
    for (const event of events) {
      const { seq, ...data } = event;
      db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(seq, event.id, JSON.stringify(data), JSON.stringify(event.payload));
    }
    for (const [hash, content] of blobs) db.prepare("INSERT INTO blobs VALUES (?,?)").run(hash, content);
    if (version === 1) db.exec("DROP TABLE memory_files; DROP TABLE memory_chunks; DROP TABLE memory_graph_nodes; DROP TABLE memory_graph_edges");
    if (version < 3) db.exec("DROP TABLE dependency_cache_objects");
    db.exec(`CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END; PRAGMA user_version=${version}; COMMIT;`);
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
