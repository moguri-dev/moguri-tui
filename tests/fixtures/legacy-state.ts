import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import type { startService } from "../../apps/service/src/server.ts";
import { hasChatTitleHistory, hasLiveDeliveryHistory, hasCombinedWorkspaceHistory, hasSessionControlsHistory, hasVoiceShortcutHistory, PROTOCOL_VERSION, resolveControls, type StoredEvent } from "../../packages/protocol/src/index.ts";
import { randomUUID } from "node:crypto";
import type { ControlPlane } from "../../apps/service/src/controller.ts";
import type { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { hasMilestoneCandidateHistory, hasMilestoneModelHistory } from "../../packages/protocol/src/milestone-models.ts";
import { hasGithubPrCiHistory } from "../../packages/protocol/src/github-workflows.ts";
import { prWorkflowItem } from "../../packages/protocol/src/pr-actions.ts";
import { hasPrAutomationHistory } from "../../packages/protocol/src/pr-automation.ts";
import { hasMyWorkHistory } from "../../packages/protocol/src/my-work.ts";
import { hasBackgroundServiceHistory } from "../../packages/protocol/src/application.ts";
import { hasScriptInboxHistory, hasNativeScriptHistory } from "../../packages/protocol/src/script-reviews.ts";
import { hasRepositoryWorkflowHistory } from "../../packages/protocol/src/repository-trust.ts";
import { hasNativeCandidateIdentityHistory } from "../../packages/protocol/src/candidate-workspaces.ts";

export async function appendLegacyProjectFreeSession(client: MoguriSdk, control: ControlPlane, title: string): Promise<{ id: string }> {
  const snapshot = control.snapshot(), settings = snapshot.settings;
  const startup = resolveControls([
    { source: "global", values: settings.values.startup.global }, { source: "profile", values: settings.values.startup.profile },
    { source: "project", values: {} }, { source: "session", values: {} },
  ], { settingsRevision: settings.revision, projectRevision: null }, snapshot.lastModelSelection);
  const id = randomUUID();
  control.store.commit([{ event_type: "session.created", profile_id: snapshot.profileId, session_id: id, payload: { title, ...startup } }]);
  control.refreshProfile(); await client.refresh(); return { id };
}
export async function appendLegacyProjectSession(client: MoguriSdk, control: ControlPlane, projectId: string, title: string): Promise<{ id: string }> {
  const snapshot = control.snapshot(), settings = snapshot.settings;
  if (!snapshot.projects.some((project) => project.id === projectId)) throw new Error("Generate an original attached session only for its actual retained project.");
  const { configuration } = await client.projects.configuration(projectId);
  const startup = resolveControls([
    { source: "global", values: settings.values.startup.global }, { source: "profile", values: settings.values.startup.profile },
    { source: "project", values: configuration.values.defaults }, { source: "session", values: {} },
  ], { settingsRevision: settings.revision, projectRevision: configuration.revision }, snapshot.lastModelSelection);
  const id = randomUUID();
  control.store.commit([{ event_type: "session.created", profile_id: snapshot.profileId, project_id: projectId,
    session_id: id, payload: { title, ...startup } }]);
  control.refreshProfile(); await client.refresh(); return { id };
}
export async function appendLegacyKupoSelection(client: MoguriSdk, control: ControlPlane, sessionId: string, env: "Local" | "Remote") {
  const session = control.snapshot().sessions.find((session) => session.id === sessionId);
  if (!session || session.turnId || session.controls.kupoMode !== undefined) throw new Error("Generate an original pre-mode Kupo selection, not a relabelled new mode.");
  control.store.commit([{ event_type: "session.configured", profile_id: client.profileId, project_id: session.projectId, session_id: sessionId,
    payload: { controls: { ...session.controls, env, modelId: "kupo" } } }]);
  control.refreshProfile(); await client.refresh();
  return { revision: control.snapshot().sessions.find((session) => session.id === sessionId)!.revision };
}

export function assertCurrentSchema(store: { db: DatabaseSync }): void {
  assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
}
export function assertPreWorkspaceHistory(events: readonly StoredEvent[]): void {
  if (hasCombinedWorkspaceHistory(events)) throw new Error("Generate genuine pre-workspace-interaction history; actual combined80 queue/native runtime cannot become an older fixture.");
  for (const event of events) {
    if (event.event_type === "project.folder_removed" || event.event_type === "project.folder_saved" && event.payload.folder.color !== undefined) {
      throw new Error("Generate genuine pre-workspace-interaction history; queued commands, group actions and grouped Sandbox authority cannot become older state.");
    }
  }
}
export function assertPreCombinedHistory(events: readonly StoredEvent[]): void {
  if (hasCombinedWorkspaceHistory(events)) throw new Error("Generate genuine pre-combined80 history; actual queue/native runtime cannot become standalone79.");
}
export function removeRecoveryFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "session.configured" && event.payload.autonomySelection ||
    event.event_type === "workspace.saved" && event.payload.branchOperation ||
    event.event_type === "tool.started" && ["git_read", "git_write"].includes(event.payload.call.name) ||
    event.event_type === "github.operation_recorded" && (event.payload.operation.toolCallDigest ||
      ["git.branch.create", "git.branch.rename", "git.switch", "git.revert", "git.commit", "git.stage", "git.unstage"].includes(event.payload.operation.kind)))) {
    throw new Error("Generate genuine pre-recovery history; explicit autonomy and built-in Git intent cannot become older state.");
  }
  removeCommandToolFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('session_request_recovery_schema','builtin_git_schema')");
}
export function removeCommandToolFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeContentReviewFixtureMarkers(db, events);
  if (events.some((event) => event.event_type === "session.resumed" && event.payload.continuation ||
    event.event_type === "settings.updated" && event.payload.settings.toolPreferences !== undefined ||
    (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && (event.payload.item.spawnPromptOrigin ||
      event.payload.item.workflow && !["review", "security", "performance", "debug"].includes(event.payload.item.workflow.kind) ||
      event.payload.item.command && ["impeccable", "continue", "orchestrate", "spawn", "spar", "critique", "roast-me", "tool-preferences"].includes(event.payload.item.command.name)) ||
    event.event_type === "tool.requested" && event.payload.approval.call.directMcp ||
    (event.event_type === "tool.started" || event.event_type === "tool.completed") && event.payload.call.directMcp)) {
    throw new Error("Generate genuine pre-82 history; actual command/tool preferences cannot become older state.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('workflow_commands_schema','tool_preferences_schema')");
}
export function removeContentReviewFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "script.review_recorded" ||
    (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "review_script" ||
    (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "run_script" ||
    (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && event.payload.item.command?.name === "script-review")) {
    throw new Error("Generate genuine pre-83 history; actual source/review/force intent cannot become older state.");
  }
  removeIntakeFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('work_item_comments_schema','repository_script_review_schema')");
}
export function removeIntakeFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => ["prompt.schedule_recorded", "model.request_bound", "model.authorization_changed", "model.failure_recorded", "recovery.cycle_recorded", "turn.retry_started", "routing.roles_planned", "routing.role_started"].includes(event.event_type) ||
    event.event_type === "budget.plan_recorded" && event.payload.plan.purpose === "routing" ||
    event.event_type === "compaction.saved" && event.payload.compaction.automatic !== undefined ||
    event.event_type === "context.changed" && event.payload.actor === "kupo-policy" || event.event_type === "routing.context_rebound" ||
    (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "read_tool_result" &&
      (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.arguments.action === "history" ||
    (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.kupoMode !== undefined ||
    event.event_type === "model.selection_remembered" && event.payload.selection?.kupoMode !== undefined ||
    event.event_type === "routing.started" && event.payload.routing.mode !== undefined ||
    event.event_type === "settings.updated" && (event.payload.settings.interactions?.idleScheduleAction !== undefined ||
      event.payload.settings.startup?.global?.kupoMode !== undefined || event.payload.settings.startup?.profile?.kupoMode !== undefined ||
      event.payload.settings.kupo?.workflow === "auto" && (event.payload.settings.kupo.modelProfiles !== undefined || event.payload.settings.kupo.automaticLimits !== undefined || event.payload.settings.kupo.autoCompaction !== undefined)) ||
    event.event_type === "project.configured" && event.payload.configuration.values?.defaults?.kupoMode !== undefined ||
    event.event_type === "global.controls_changed" && event.payload.values.kupoMode !== undefined)) {
    throw new Error("Generate genuine pre-84 history; original scheduling/recovery/mode intent cannot become older state.");
  }
  removeOwnedTransportFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('model_failure_recovery_schema','scheduled_prompts_schema','kupo_modes_schema')");
}
export function removeOwnedTransportFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation?.version === 2 ||
    event.event_type === "decision.recorded" && Object.hasOwn(event.payload.decision, "transport") ||
    event.event_type === "winddown.recorded" && Object.hasOwn(event.payload.winddown, "transport"))) {
    throw new Error("Generate genuine pre-85 history; scheduled native/owned model/finishing intent cannot become older state.");
  }
  removeRetryCheckpointFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('scheduled_native_preparation_schema','owned_model_transport_schema','transport_finishing_schema')");
}
export function removeRetryCheckpointFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeSessionControlsFixtureMarkers(db, events);
  if (events.some((event) => event.event_type === "model.request_bound" && event.payload.nativeRestaging ||
    event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation?.version === 3 ||
    event.event_type === "settings.updated" && event.payload.settings.interactions?.nativeRetryRestaging !== undefined ||
    event.event_type === "winddown.recorded" && (event.payload.winddown.version === 3 || event.payload.winddown.commit?.inspection))) {
    throw new Error("Generate genuine pre-86 history; private retry/checkpoint authority cannot become older state.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('native_retry_restaging_schema','transport_checkpoint_schema')");
}
export function removeSessionControlsFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (hasSessionControlsHistory(events)) {
    throw new Error("Generate genuine pre-87 history; voice lifecycle, peer/dependency and bulk authority cannot become older state.");
  }
  removeVoiceShortcutFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('session_coordination_controls_schema','session_pr_associations_schema','voice_lifecycle_schema','chat_outputs_schema','language_app_tools_schema')");
}
export function removeVoiceShortcutFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (hasVoiceShortcutHistory(events)) throw new Error("Generate genuine pre-88 history; an explicit shortcut choice cannot become a legacy button preference.");
  removeEventReadFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='voice_shortcut_schema'");
}
export function removeChatTitleFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeRepositoryManagementFixtureMarkers(db, events);
  if (hasChatTitleHistory(events) || hasLiveDeliveryHistory(events)) throw new Error("Generate genuine pre-90 history; actual naming/automatic live-delivery ownership cannot become older state.");
  db.exec("DELETE FROM retention_metadata WHERE id IN ('chat_titles_schema','live_delivery_schema')");
}
export function removeRepositoryManagementFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeMilestoneCapabilityFixtureMarkers(db, events);
  if (events.some((event) => event.event_type === "repository.import_recorded" ||
    event.event_type === "github.operation_recorded" && event.payload.operation.kind === "git.remote.set")) {
    throw new Error("Generate genuine pre-91 history; actual reviewed repository import/remote ownership cannot become older state.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('repository_import_batches_schema','repository_remote_changes_schema')");
}
export function removeMilestoneCapabilityFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeGithubPrCiFixtureMarker(db, events);
  if (hasMilestoneModelHistory(events) || hasMilestoneCandidateHistory(events)) {
    throw new Error("Generate genuine pre-92 history; runtime requirements, pooled controls and transport candidates cannot become older state.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('model_runtime_readiness_schema','kupo_options_schema','candidate_transports_schema')");
}
export function removeGithubPrCiFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeMyWorkFixtureMarker(db, events);
  if (hasGithubPrCiHistory(events)) throw new Error("Generate genuine pre-93 history; retained PR CI-watch ownership cannot become older state.");
  db.exec("DELETE FROM retention_metadata WHERE id='github_pr_ci_watch_schema'");
}
export function removeMyWorkFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeBackgroundServiceFixtureMarker(db, events);
  if (hasMyWorkHistory(events)) throw new Error("Generate genuine pre-95 history; actual configured inbox sources/refreshes cannot become an older lineage.");
  db.exec("DELETE FROM retention_metadata WHERE id='my_work_inbox_schema'");
}
export function removeBackgroundServiceFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeOtlpExportFixtureMarker(db, events);
  if (hasBackgroundServiceHistory(events)) throw new Error("Generate genuine pre-96 history; an explicit background-service preference cannot become an older lineage.");
  db.exec("DELETE FROM retention_metadata WHERE id='background_service_schema'");
}
export function removeOtlpExportFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeSkillsRewindFixtureMarkers(db, events);
  if (events.some((event) => event.event_type === "telemetry.export_configured")) throw new Error("Generate genuine pre-97 history; reviewed export intent cannot become an older lineage.");
  db.exec("DELETE FROM retention_metadata WHERE id='otlp_export_schema'");
}
export function removeSkillsRewindFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeInboxSkillFixtureMarkers(db, events);
  if (events.some((event) => event.event_type.startsWith("checkpoint.") || event.event_type.startsWith("rewind.") ||
    ["skill.admission_recorded", "skill.consumed", "session.rewound"].includes(event.event_type) ||
    event.event_type === "sandbox.workspace_recorded" && [4, 5].includes(event.payload.workspace.preparation?.version ?? 0)) ||
    db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') LIKE 'checkpoint.%' OR json_extract(data,'$.event_type') LIKE 'rewind.%' OR json_extract(data,'$.event_type') IN ('skill.admission_recorded','skill.consumed','session.rewound') LIMIT 1").get()) {
    throw new Error("Generate genuine pre-98 history using its original journal before the first turn. Actual captured/admitted/rewound history cannot be relabelled or removed.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('local_skill_admission_schema','turn_checkpoints_schema')");
}
export function removeInboxSkillFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeScriptInboxFixtureMarkers(db, events);
  if (events.some((event) => event.event_type === "attention.deleted" || event.event_type === "skill.loaded") ||
    db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('attention.deleted','skill.loaded') LIMIT 1").get()) {
    throw new Error("Generate genuine pre-99 history; deleted notifications and actual explicit skill loads cannot be relabelled or removed.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('session_inbox_schema','explicit_skill_load_schema')");
}
export function removeScriptInboxFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeRepositoryWorkflowFixtureMarkers(db, events);
  if (hasScriptInboxHistory(events) ||
    db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='script.review_approved' LIMIT 1").get()) {
    throw new Error("Generate genuine pre-100 history; actual script Inbox/approval/tool failure history cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('script_review_inbox_schema','tool_failure_schema')");
}
export function removeRepositoryWorkflowFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeNativeCandidateIdentityFixtureMarker(db, events);
  if (hasRepositoryWorkflowHistory(events) || db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('repository.trust_recorded','repository.script_reserved','turn.recovery_entered') LIMIT 1").get()) {
    throw new Error("Generate genuine pre-101 history; actual trust, default worktree intent and partial recovery cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('repository_trust_schema','project_workflow_defaults_schema','partial_tool_recovery_schema')");
}
export function removeNativeCandidateIdentityFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeNativeScriptFixtureMarker(db, events);
  if (hasNativeCandidateIdentityHistory(events)) throw new Error("Generate genuine pre-102 history; actual private-root grants cannot become historical VM identities.");
  db.exec("DELETE FROM retention_metadata WHERE id='native_candidate_identity_schema'");
}
export function removeNativeScriptFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeChatRepositoryBindingFixtureMarker(db, events);
  if (hasNativeScriptHistory(events) || db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='script.review_recorded' AND json_type(data,'$.turn_id')='text' LIMIT 1").get()) {
    throw new Error("Generate genuine pre-103 history; actual native script root grants and observed results cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id='native_script_execution_schema'");
}
export function removeClaudeAgentFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type.startsWith("agent.") ||
    event.event_type === "settings.updated" && event.payload.settings.claudeAgent !== undefined ||
    event.event_type === "tool.requested" && event.payload.approval.call.harness !== undefined ||
    event.event_type === "tool.completed" && event.payload.call.harness !== undefined)) {
    throw new Error("Generate genuine pre-108 history; actual Claude Agent sessions, harness tools and settings cannot be relabelled.");
  }
  removeWorkspaceFoldersFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='claude_agent_harness_schema'");
}
export function removeWorkspaceFoldersFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type.startsWith("workspace_folder.") ||
    event.event_type === "project.added" && event.payload.project.workspaceFolderId !== undefined ||
    event.event_type === "project.configured" && (event.payload.configuration.values.repo.screenshots !== undefined ||
      event.payload.configuration.values.repo.installers !== undefined || event.payload.configuration.values.repo.installerCommand !== undefined) ||
    (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && event.payload.item.lifecycle !== undefined ||
    event.event_type === "chat.title_recorded" && event.payload.title.purpose !== undefined ||
    event.event_type === "settings.updated" && (event.payload.settings.git !== undefined || event.payload.settings.wrapUp !== undefined || event.payload.settings.shortcuts?.openApp !== undefined ||
      event.payload.settings.chatTitles?.refresh !== undefined ||
      event.payload.settings.retention?.archiveMerged !== undefined || event.payload.settings.retention?.archiveMergedAfterDays !== undefined))) {
    throw new Error("Generate genuine pre-109 history; actual workspace folders, read-only folder projects, branch prefixes, merged-session archive settings, lifecycle turns/settings and title refreshes cannot be relabelled.");
  }
  removeSmartCompactionFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='workspace_folders_schema'");
}
export function removeSmartCompactionFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "settings.updated" && event.payload.settings.compaction !== undefined ||
    event.event_type === "compaction.saved" && (event.payload.compaction.applyOnSuccess !== undefined || event.payload.compaction.automatic?.scope !== undefined ||
      event.payload.compaction.automatic?.actor === "default-policy") ||
    event.event_type === "context.changed" && event.payload.actor === "compaction-policy")) {
    throw new Error("Generate genuine pre-110 history; actual smart compaction settings, default-policy or fixed-model automatic compactions and /compact applications cannot be relabelled.");
  }
  removeStainlessIntegrationFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='smart_compaction_schema'");
}
export function removeStainlessIntegrationFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "settings.updated" && event.payload.settings.integrations?.stainless !== undefined)) {
    throw new Error("Generate genuine pre-111 history; actual Stainless integration settings cannot be relabelled.");
  }
  removeSourceTrustTelemetryFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='stainless_integration_schema'");
}
export function removeSourceTrustTelemetryFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "skill.publisher_saved" || event.event_type === "skill.trust_blocked" ||
    event.event_type === "tool.background_completed" || event.event_type === "tool.completed" && event.payload.outcome === "background" ||
    (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && prWorkflowItem(event.payload.item) ||
    event.event_type === "settings.updated" && (event.payload.settings.scriptReview !== undefined || event.payload.settings.retention?.archiveBranchCleanup !== undefined) ||
    event.event_type === "workspace.saved" && (event.payload.workspace.volume !== undefined || event.payload.workspace.parked !== undefined || event.payload.workspace.cleanup !== undefined) ||
    event.event_type === "application.virtual_disk_saved" ||
    event.event_type === "skill.admission_recorded" && event.payload.admission.publisher.kind === "saved-ed25519" ||
    event.event_type === "telemetry.export_configured" && (event.payload.configuration.disclosureVersion !== 1 ||
      event.payload.configuration.logs !== undefined || event.payload.configuration.headers !== undefined))) {
    throw new Error("Generate genuine pre-112 history; actual publisher keys/blocks, scanner risk acceptance, saved-key admissions, OTLP log/credential configuration, steer-backgrounded commands, pull request follow-up workflows, archive worktree cleanup and the virtual disk cannot be relabelled.");
  }
  removePrAutomationFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('skill_publisher_trust_schema','otlp_signals_credentials_schema','background_command_schema')");
}
export function removePrAutomationFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some(hasPrAutomationHistory)) {
    throw new Error("Generate genuine pre-113 history; actual pull request automation settings, repository overrides, CI retries and conflict resolution turns cannot be relabelled.");
  }
  removeToolSuggestionAutomationFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='pr_automation_schema'");
}
export function removeToolSuggestionAutomationFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "settings.updated" && event.payload.settings.automations !== undefined ||
    event.event_type === "attention.raised" && event.payload.attention.reason === "tool-suggestion")) {
    throw new Error("Generate genuine pre-114 history; actual automation settings and repeated-task tool suggestions cannot be relabelled.");
  }
  removeAutomationsFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='tool_suggestion_automation_schema'");
}
export function removeAutomationsFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "automation.recorded" || event.event_type === "automation.run_recorded" ||
    (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && event.payload.item.automation !== undefined ||
    event.event_type === "repository.script_reserved" && event.payload.attempt.automation !== undefined)) {
    throw new Error("Generate genuine pre-115 history; actual automations, their runs and automation-owned steps cannot be relabelled.");
  }
  if (events.some((event) => event.event_type === "session.interruption_recorded" ||
    event.event_type === "settings.updated" && event.payload.settings.interactions?.continueInterrupted !== undefined)) {
    throw new Error("Generate genuine pre-115 history; actual interrupted-chat records and the continue-interrupted setting cannot be relabelled.");
  }
  removeRoundupsPersonasFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('automations_schema','interrupted_sessions_schema')");
}
export function removeRoundupsPersonasFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "dependency_roundup.recorded" || event.event_type === "dependency_roundup.run_recorded" ||
    event.event_type === "my_work.refresh_recorded" && (event.payload.refresh.actor !== "user" || event.payload.refresh.trigger !== undefined))) {
    throw new Error("Generate genuine pre-119 history; actual dependency roundups and schedule-triggered inbox refreshes cannot be relabelled.");
  }
  if (events.some((event) => event.event_type === "persona.recorded" || event.event_type === "persona.run_recorded")) {
    throw new Error("Generate genuine pre-119 history; actual personas and persona runs cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id IN ('dependency_roundups_schema','personas_schema')");
}
export function removeExternalVoiceModelFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "job.started" && event.payload.job.kind === "voice.inspect" ||
    event.event_type === "settings.updated" && event.payload.settings.voice?.model !== undefined ||
    event.event_type === "skill.admission_recorded" && event.payload.admission.basis !== undefined ||
    event.event_type === "draft.saved" && event.payload.attachments.some((attachment) => attachment.kind === "skill") ||
    event.event_type === "question.answered" && event.payload.answer.skipped !== undefined)) {
    throw new Error("Generate genuine pre-107 history; actual external voice model reviews, trusted selections, trusted-folder skill admissions, skill attachments and skipped questions cannot be relabelled.");
  }
  removeClaudeAgentFixtureMarker(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='external_voice_model_schema'");
}
export function removeCapabilityDeletionFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeExternalVoiceModelFixtureMarker(db, events);
  if (events.some((event) => event.event_type === "capability.deleted") ||
    db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='capability.deleted' LIMIT 1").get()) {
    throw new Error("Generate genuine pre-106 history; actual skill deletions cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id='capability_deletion_schema'");
}
export function removeChatRepositoryBindingFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeCapabilityDeletionFixtureMarker(db, events);
  if (events.some((event) => ["session.repository_observed", "session.repository_dismissed", "session.project_bound"].includes(event.event_type) ||
    event.event_type === "settings.updated" && event.payload.settings.interactions?.confirmRepositoryImport !== undefined) ||
    db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('session.repository_observed','session.repository_dismissed','session.project_bound') LIMIT 1").get()) {
    throw new Error("Generate genuine pre-105 history; actual chat repository observations, bindings and import preferences cannot be relabelled.");
  }
  db.exec("DELETE FROM retention_metadata WHERE id='chat_repository_binding_schema'");
}
export function removeEventReadFixtureMarker(db: DatabaseSync, events: readonly StoredEvent[]): void {
  removeChatTitleFixtureMarkers(db, events);
  db.exec("DROP INDEX IF EXISTS events_profile_sequence; DROP INDEX IF EXISTS events_type_sequence; DELETE FROM retention_metadata WHERE id='event_read_indexes_schema'");
}
export function removeWorkspaceFixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  assertPreWorkspaceHistory(events);
  removeRecoveryFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('queued_slash_schema','project_folder_actions_schema','sandbox_multi_root_schema','theme_model_workspace_convergence_schema')");
}
export function assertPreThemeHistory(events: readonly StoredEvent[]): void {
  if (events.some((event) => event.event_type === "settings.updated" && event.payload.settings.appearance?.palette !== undefined &&
    !["moguri", "ocean", "orchid", "custom"].includes(event.payload.settings.appearance.palette))) {
    throw new Error("Generate genuine pre-theme-catalogue history; new saved palettes cannot become older settings.");
  }
}
export function assertPreContinuityHistory(events: readonly StoredEvent[]): void {
  if (events.some((event) => (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.preferredThinkingEffort !== undefined ||
    event.event_type === "model.selection_remembered" && event.payload.selection?.preferredThinkingEffort !== undefined ||
    event.event_type === "settings.updated" && (event.payload.settings.startup?.global?.preferredThinkingEffort !== undefined || event.payload.settings.startup?.profile?.preferredThinkingEffort !== undefined) ||
    event.event_type === "project.configured" && event.payload.configuration.values?.defaults?.preferredThinkingEffort !== undefined ||
    event.event_type === "global.controls_changed" && event.payload.values.preferredThinkingEffort !== undefined)) {
    throw new Error("Generate genuine pre-continuity history; actual model effort preferences cannot become older state.");
  }
}
export function removePost77FixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  assertPreThemeHistory(events);
  removeWorkspaceFixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id='theme_catalog_schema'");
}
export function appendLegacyAutopilot(service: Awaited<ReturnType<typeof startService>>, sessionId: string, autonomy: "Autopilot" | "Autopilot Max" = "Autopilot"): void {
  const session = service.controller.snapshot().sessions.find((value) => value.id === sessionId);
  if (!session || session.controls.automaticApprovals !== undefined) throw new Error("Generate an original bounded session; never strip actual automatic-approval consent.");
  service.store.commit([{ event_type: "session.configured", profile_id: service.controller.snapshot().profileId,
    project_id: session.projectId, session_id: session.id, payload: { controls: { ...session.controls, autonomy } } }]);
  service.controller.refreshProfile();
}
/** Autopilot/Max that explicitly opts out of automatic approvals, keeping the bounded decision-layer path. */
export function appendBoundedAutopilot(service: Awaited<ReturnType<typeof startService>>, sessionId: string, autonomy: "Autopilot" | "Autopilot Max" = "Autopilot"): void {
  const session = service.controller.snapshot().sessions.find((value) => value.id === sessionId);
  if (!session || session.controls.automaticApprovals === true) throw new Error("Generate an original bounded session; never strip actual automatic-approval consent.");
  service.store.commit([{ event_type: "session.configured", profile_id: service.controller.snapshot().profileId,
    project_id: session.projectId, session_id: session.id, payload: { controls: { ...session.controls, autonomy, automaticApprovals: false } } }]);
  service.controller.refreshProfile();
}
export function removePost44FixtureMarkers(db: DatabaseSync, events: readonly StoredEvent[]): void {
  const future = db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type') IN ('candidate.owner_bound','candidate.cleanup_recorded','candidate.usage_retained','model.selection_remembered','session.pr_observed','skill.used','sandbox.setup_recorded','task.plan_updated','notification.sound_saved','notification.sound_removed','application.configured','application.storage_recorded','application.update_recorded')").get();
  if (Number(future?.count)) throw new Error("Generate genuine pre-settings history before relabeling an additive-marker fixture. New native intent or sound grants cannot become old data.");
  removePost77FixtureMarkers(db, events);
  db.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema','session_navigation_schema','workspace_experience_schema','lean_tooling_schema','lean_tooling_convergence_schema','candidate_retention_schema','browser_control_schema','model_defaults_schema','session_indicators_schema','desktop_interaction_schema','managed_sandbox_schema','session_interactions_schema','settings_preferences_schema','client_voice_capture_schema','notification_sound_schema','application_preferences_schema','state_location_schema','private_update_schema')");
}
export function retainedCiphertextRows(db: DatabaseSync) {
  return ["events", "retention_keys", "retention_forgotten", "blob_payloads", "receipts", "memory_scopes", "memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()] as const);
}
export async function writeLegacyState(service: Awaited<ReturnType<typeof startService>>, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60, lineage: "main" | "desktop" = "main"): Promise<void> {
  const events = service.store.db.isOpen ? service.store.events() : service.controller.events(0);
  assertPreWorkspaceHistory(events);
  assertPreThemeHistory(events);
  assertPreContinuityHistory(events);
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
  if (version < 76 && events.some((event) => event.event_type === "settings.updated" &&
    (event.payload.settings.retention.archiveChildren !== undefined || event.payload.settings.retention.deleteChildren !== undefined))) {
    throw new Error("Generate genuine pre-child-session-review history; remembered child dispositions cannot become older settings.");
  }
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
      removePost77FixtureMarkers(db, events);
      db.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','session_github_workflows_schema','session_github_convergence_schema')");
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
