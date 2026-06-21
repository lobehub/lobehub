import type { BriefArtifacts } from '../brief';
import type { ChatFileItem } from '../message/ui/chat';

// ── Task type aliases ──

export type TaskStatus =
  | 'backlog'
  | 'canceled'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'running'
  | 'scheduled';

export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export type TaskActivityType = 'brief' | 'comment' | 'created' | 'topic';

// null = no automation
export type TaskAutomationMode = 'heartbeat' | 'schedule';

// ── Config types ──

export interface CheckpointConfig {
  onAgentRequest?: boolean;
  tasks?: {
    afterIds?: string[];
    beforeIds?: string[];
  };
  topic?: {
    after?: boolean;
    before?: boolean;
  };
}

/**
 * Task-level delivery-acceptance (verify) gate config, persisted under
 * `tasks.config.verify`. This is the authoritative source for a task run's
 * verify gate — it is *not* unioned with any agent-level mount
 * (`agencyConfig.verifyRubricId`) — the task config is authoritative and never
 * field-level merged with the agent-level rubric.
 *
 * Subtasks inherit with whole-config override semantics: a subtask uses its own
 * config when present, otherwise the nearest ancestor's config in full (never a
 * field-level merge). Resolved at runtime via `TaskModel.resolveVerifyConfig`.
 */
export interface TaskVerifyConfig {
  /** Whether the verify gate runs on topic completion. */
  enabled?: boolean;
  /** Task-level cap on verify repair / re-run iterations. */
  maxIterations?: number;
  /**
   * Which agent executes the verify run (the Push-model review agent). When
   * omitted, falls back to the built-in verify agent. The execution target /
   * bound device is inherited from the chosen agent's `agencyConfig`, not
   * written here.
   */
  verifierAgentId?: string;
  /** One-off ad-hoc criteria ids (references `verify_criteria.id`). */
  verifyCriteriaIds?: string[];
  /** Reuse a rubric template (references `verify_rubrics.id`). */
  verifyRubricId?: string;
}

export interface WorkspaceDocNode {
  charCount: number | null;
  createdAt: string;
  fileType: string;
  parentId: string | null;
  pinnedBy: string;
  sourceTaskId: string;
  sourceTaskIdentifier: string | null;
  title: string;
  updatedAt: string | null;
}

export interface WorkspaceTreeNode {
  children: WorkspaceTreeNode[];
  id: string;
}

export interface WorkspaceData {
  nodeMap: Record<string, WorkspaceDocNode>;
  tree: WorkspaceTreeNode[];
}

/**
 * Audit record of the brief-emission decision for a completed topic.
 *
 * Persisted under `taskTopics.handoff.briefDecision`. Written for *every*
 * synthesizeTopicBrief invocation (rule-conclusive and LLM-deferred alike) so
 * the emit/skip outcome is inspectable per topic.
 *
 * - source='rule' — the deterministic gate (`shouldEmitTopicBrief`) was
 *   conclusive on its own. `reason` mirrors the rule's reason string.
 * - source='llm-judge' — the rule returned 'unknown' and an LLM made the call
 *   via `chainJudgeBriefEmit`. `model` records which model voted.
 */
export interface BriefDecision {
  decidedAt: string;
  emit: boolean;
  model?: string;
  reason: string;
  source: 'rule' | 'llm-judge';
}

export interface TaskTopicHandoff {
  /**
   * Outcome of the emit-vs-skip decision for the brief on this topic. The
   * three LLM-produced fields above are agent-internal; this one is metadata
   * about the brief delivery itself, written by the lifecycle service.
   */
  briefDecision?: BriefDecision;
  keyFindings?: string[];
  nextAction?: string;
  summary?: string;
  title?: string;
}

// ── Task context (runtime state pockets stored in tasks.context JSONB) ──

export interface TaskSchedulerContext {
  // Count of consecutive 'error' reasons since the last 'done'. When it hits
  // the fuse threshold (currently 3) we stop re-arming until the user resolves
  // the urgent brief.
  consecutiveFailures?: number;
  // ISO timestamp when the latest tick was scheduled. Informational only.
  scheduledAt?: string;
  // QStash messageId (or LocalScheduler scheduleId) for the next tick. Used to
  // cancel when the user wants an interval change to take effect immediately.
  tickMessageId?: string;
}

export interface TaskContext {
  scheduler?: TaskSchedulerContext;
}

// ── Task list item (shared between router response and client) ──

export interface TaskParticipant {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string;
  type: 'user' | 'agent';
}

export interface TaskItem {
  accessedAt: Date;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  automationMode: TaskAutomationMode | null;
  completedAt: Date | null;
  config: unknown;
  context: unknown;
  createdAt: Date;
  createdByAgentId: string | null;
  createdByUserId: string;
  currentTopicId: string | null;
  description: string | null;
  editorData: unknown;
  error: string | null;
  heartbeatInterval: number | null;
  heartbeatTimeout: number | null;
  id: string;
  identifier: string;
  instruction: string;
  lastHeartbeatAt: Date | null;
  maxTopics: number | null;
  name: string | null;
  parentTaskId: string | null;
  priority: number | null;
  schedulePattern: string | null;
  scheduleTimezone: string | null;
  seq: number;
  sortOrder: number | null;
  startedAt: Date | null;
  status: string;
  totalTopics: number | null;
  updatedAt: Date;
  workspaceId: string | null;
}

export type TaskListItem = TaskItem & {
  participants: TaskParticipant[];
};

export interface NewTask {
  accessedAt?: Date;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  automationMode?: TaskAutomationMode | null;
  completedAt?: Date | null;
  config?: unknown;
  context?: unknown;
  createdAt?: Date;
  createdByAgentId?: string | null;
  createdByUserId: string;
  currentTopicId?: string | null;
  description?: string | null;
  editorData?: unknown;
  error?: string | null;
  heartbeatInterval?: number | null;
  heartbeatTimeout?: number | null;
  id?: string;
  identifier: string;
  instruction: string;
  lastHeartbeatAt?: Date | null;
  maxTopics?: number | null;
  name?: string | null;
  parentTaskId?: string | null;
  priority?: number | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  seq: number;
  sortOrder?: number | null;
  startedAt?: Date | null;
  status?: string;
  totalTopics?: number | null;
  updatedAt?: Date;
  workspaceId?: string | null;
}

// ── Task Detail (shared across CLI, viewTask tool, task.detail router) ──

export interface TaskDetailSubtaskAssignee {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface TaskDetailSubtask {
  assignee?: TaskDetailSubtaskAssignee | null;
  automationMode?: TaskAutomationMode | null;
  blockedBy?: string;
  children?: TaskDetailSubtask[];
  heartbeat?: { interval?: number | null };
  identifier: string;
  name?: string | null;
  priority?: number | null;
  schedule?: { pattern?: string | null; timezone?: string | null };
  status: string;
}

export interface TaskDetailWorkspaceNode {
  children?: TaskDetailWorkspaceNode[];
  createdAt?: string;
  documentId: string;
  fileType?: string;
  size?: number | null;
  sourceTaskId?: string;
  sourceTaskIdentifier?: string | null;
  title?: string;
}

export interface TaskDetailActivityAuthor {
  avatar?: string | null;
  id: string;
  name?: string | null;
  type: 'agent' | 'user';
}

export interface TaskDetailActivityAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface TaskDetailActivity {
  actions?: unknown;
  /** Brief-only: avatar of the agent that produced this brief; `null` when the agent is unknown or has been deleted. */
  agent?: TaskDetailActivityAgent | null;
  agentId?: string | null;
  artifacts?: BriefArtifacts | null;
  author?: TaskDetailActivityAuthor;
  briefType?: string;
  /**
   * Topic-only: ISO timestamp when the topic run terminated (any of
   * completed / failed / canceled / timeout). Pair with `time` (start) to
   * compute elapsed duration.
   */
  completedAt?: string;
  content?: string;
  createdAt?: string;
  cronJobId?: string | null;
  /** Comment-only: rich Lexical JSON state. When present, supersedes `content` for rendering. */
  editorData?: unknown;
  /** Comment-only: files attached to this comment for rendering in the UI. */
  files?: ChatFileItem[];
  id?: string;
  /**
   * Topic-only: persisted Gateway operation ID for the task topic, sourced
   * from `task_topics.operationId`. Survives across runs (created on add,
   * updated on resume) so it remains available after the topic completes —
   * unlike `runningOperation`, which is cleared when the run terminates.
   */
  operationId?: string | null;
  priority?: string | null;
  readAt?: string | null;
  resolvedAction?: string | null;
  resolvedAt?: string | null;
  resolvedComment?: string | null;
  /**
   * Topic-only: currently running Gateway operation, mirrored from
   * `topics.metadata.runningOperation`. Lets the task topic drawer establish
   * a Gateway WebSocket reconnection without a separate topic lookup.
   */
  runningOperation?: {
    assistantMessageId: string;
    operationId: string;
    scope?: string;
    threadId?: string | null;
  } | null;
  seq?: number | null;
  status?: string | null;
  summary?: string;
  taskId?: string | null;
  time?: string;
  title?: string;
  topicId?: string | null;
  type: TaskActivityType;
  userId?: string | null;
}

export interface TaskDetailData {
  activities?: TaskDetailActivity[];
  agentId?: string | null;
  // null/undefined = no automation configured
  automationMode?: TaskAutomationMode | null;
  checkpoint?: CheckpointConfig;
  config?: Record<string, unknown>;
  createdAt?: string;
  dependencies?: Array<{ dependsOn: string; type: string }>;
  description?: string | null;
  /** Rich-editor JSON state for the instruction; preserves details markdown drops (image size, etc.). */
  editorData?: unknown;
  error?: string | null;
  /** Files attached to the task instruction (persistent context for every run). */
  files?: ChatFileItem[];
  // heartbeat.interval: periodic execution interval | heartbeat.timeout+lastAt: watchdog monitoring (detects stuck tasks)
  heartbeat?: {
    interval?: number | null;
    lastAt?: string | null;
    timeout?: number | null;
  };
  identifier: string;
  instruction: string;
  name?: string | null;
  parent?: { agentId?: string | null; identifier: string; name: string | null } | null;
  priority?: number | null;
  schedule?: {
    maxExecutions?: number | null;
    pattern?: string | null;
    timezone?: string | null;
  };
  status: string;
  subtasks?: TaskDetailSubtask[];
  topicCount?: number;
  userId?: string | null;
  /** Task-level verify (delivery-acceptance) gate config; `tasks.config.verify`. */
  verify?: TaskVerifyConfig | null;
  workspace?: TaskDetailWorkspaceNode[];
  /** Owning workspace; null for personal (non-workspace) tasks. */
  workspaceId?: string | null;
}
