import type { TaskAutomationMode, TaskStatus } from './task';

export type WorkType = 'document' | 'github' | 'linear' | 'task';
export type LinearWorkResourceType = 'linear_document' | 'linear_issue';
export type GithubWorkResourceType = 'github_issue' | 'github_pull_request';
export type WorkResourceType =
  'document' | GithubWorkResourceType | LinearWorkResourceType | 'task';
/**
 * How a version changed the Work. Not derivable from `version === 1`: updating
 * an external resource that was never registered before yields a v1 row with
 * role='updated'.
 */
export type WorkVersionRole = 'created' | 'updated';

export interface TaskWorkVersionSnapshot {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  automationMode: TaskAutomationMode | null;
  config: unknown;
  context: unknown;
  createdByAgentId: string | null;
  currentTopicId: string | null;
  description: string | null;
  editorData: unknown;
  error: string | null;
  heartbeatInterval: number | null;
  heartbeatTimeout: number | null;
  id: string;
  identifier: string;
  instruction: string;
  maxTopics: number | null;
  name: string | null;
  parentTaskId: string | null;
  priority: number | null;
  schedulePattern: string | null;
  scheduleTimezone: string | null;
  sortOrder: number | null;
  status: TaskStatus | string;
  totalTopics: number | null;
}

export interface DocumentWorkVersionSnapshot {
  description: string | null;
  id: string;
  title: string | null;
  url: string | null;
}

export type LinearWorkEntityType = 'document' | 'issue';

export interface LinearWorkVersionSnapshot {
  assignee: string | null;
  assigneeId: string | null;
  color: string | null;
  content: string | null;
  createdAt: string | null;
  description: string | null;
  dueDate: string | null;
  icon: string | null;
  id: string;
  identifier: string | null;
  issueId: string | null;
  issueIdentifier: string | null;
  labels: string[];
  parentId: string | null;
  priority: string | null;
  priorityValue: number | null;
  project: string | null;
  projectId: string | null;
  slugId: string | null;
  status: string | null;
  statusType: string | null;
  targetId: string | null;
  targetIdentifier: string | null;
  targetType: LinearWorkEntityType | 'initiative' | 'milestone' | 'project' | null;
  team: string | null;
  teamId: string | null;
  title: string | null;
  updatedAt: string | null;
  url: string | null;
}

export type LinearWorkPatchField = keyof Omit<LinearWorkVersionSnapshot, 'id'>;

export type GithubWorkEntityType = 'issue' | 'pull_request';

export interface GithubWorkVersionSnapshot {
  assignees: string[];
  author: string | null;
  baseRef: string | null;
  body: string | null;
  closedAt: string | null;
  createdAt: string | null;
  draft: boolean | null;
  headRef: string | null;
  id: string;
  labels: string[];
  merged: boolean | null;
  mergedAt: string | null;
  number: number | null;
  repo: string | null;
  state: string | null;
  stateReason: string | null;
  title: string | null;
  updatedAt: string | null;
  url: string | null;
}

export type GithubWorkPatchField = keyof Omit<GithubWorkVersionSnapshot, 'id'>;

export type WorkVersionSnapshot =
  | {
      document: DocumentWorkVersionSnapshot;
    }
  | {
      github: GithubWorkVersionSnapshot;
    }
  | {
      linear: LinearWorkVersionSnapshot;
    }
  | {
      task: TaskWorkVersionSnapshot;
    };

export interface WorkVersionMetadata {
  agentDocumentId?: string;
}

export interface WorkVersionCumulativeUsage {
  capturedAt: string;
  cost?: unknown;
  usage?: unknown;
}

export interface WorkItem {
  createdAt: Date;
  currentVersionId: string | null;
  id: string;
  resourceId: string;
  resourceIdentifier: string | null;
  resourceType: WorkResourceType;
  type: WorkType;
  updatedAt: Date;
  userId: string;
  workspaceId: string | null;
}

export interface WorkVersionItem {
  actorAgentId: string | null;
  createdAt: Date;
  cumulativeCost: number | null;
  cumulativeUsage: WorkVersionCumulativeUsage | null;
  id: string;
  metadata: WorkVersionMetadata | null;
  role: WorkVersionRole;
  rootOperationId: string | null;
  snapshot: WorkVersionSnapshot;
  source: string;
  sourceMessageId: string | null;
  sourceToolCallId: string | null;
  threadId: string | null;
  topicId: string | null;
  userId: string;
  version: number;
  workId: string;
  workspaceId: string | null;
}

/** Version fields embedded in Work list rows (the mutation event that surfaced the Work). */
export type WorkVersionPreview = Pick<
  WorkVersionItem,
  | 'createdAt'
  | 'cumulativeCost'
  | 'id'
  | 'metadata'
  | 'role'
  | 'rootOperationId'
  | 'source'
  | 'sourceMessageId'
  | 'sourceToolCallId'
  | 'version'
>;

export interface TaskWorkListItem extends WorkItem {
  resourceType: 'task';
  task: {
    /**
     * Card preview text: the task's instruction (NOT NULL on live rows),
     * truncated server-side — never the full text.
     */
    instruction: string | null;
    name: string | null;
    priority: number | null;
    status: TaskStatus | string | null;
  };
  /**
   * The live task row backing this Work no longer exists (deleted outside the
   * tool-dispatch path, which deliberately orphans the Work). When true, the
   * `task` fields fall back to the version snapshot and the UI renders the card
   * as "task deleted". Derived from a `tasks` LEFT JOIN missing its row, not a
   * persisted flag.
   */
  taskDeleted: boolean;
  type: 'task';
}

export interface DocumentWorkListItem extends WorkItem {
  document: DocumentWorkVersionSnapshot;
  resourceType: 'document';
  type: 'document';
}

export interface LinearWorkListItem extends WorkItem {
  linear: LinearWorkVersionSnapshot;
  resourceType: LinearWorkResourceType;
  type: 'linear';
}

export interface GithubWorkListItem extends WorkItem {
  github: GithubWorkVersionSnapshot;
  resourceType: GithubWorkResourceType;
  type: 'github';
}

export type WorkListItem =
  DocumentWorkListItem | GithubWorkListItem | LinearWorkListItem | TaskWorkListItem;

export interface TaskWorkVersionEventItem extends TaskWorkListItem {
  version: WorkVersionPreview;
}

export interface DocumentWorkVersionEventItem extends DocumentWorkListItem {
  version: WorkVersionPreview;
}

export interface LinearWorkVersionEventItem extends LinearWorkListItem {
  version: WorkVersionPreview;
}

export interface GithubWorkVersionEventItem extends GithubWorkListItem {
  version: WorkVersionPreview;
}

export type WorkVersionEventItem =
  | DocumentWorkVersionEventItem
  | GithubWorkVersionEventItem
  | LinearWorkVersionEventItem
  | TaskWorkVersionEventItem;
export type WorkVersionEventMap = Record<string, WorkVersionEventItem[]>;

export interface TaskWorkSummaryItem extends TaskWorkListItem {
  event: WorkVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface DocumentWorkSummaryItem extends DocumentWorkListItem {
  event: WorkVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface LinearWorkSummaryItem extends LinearWorkListItem {
  event: WorkVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface GithubWorkSummaryItem extends GithubWorkListItem {
  event: WorkVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export type WorkSummaryItem =
  DocumentWorkSummaryItem | GithubWorkSummaryItem | LinearWorkSummaryItem | TaskWorkSummaryItem;
export type WorkSummaryMap = Record<string, WorkSummaryItem[]>;

export interface RegisterDocumentWorkParams {
  actorAgentId?: string | null;
  agentDocumentId?: string | null;
  agentId?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  documentId: string;
  role: WorkVersionRole;
  rootOperationId?: string | null;
  source: string;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  url?: string | null;
}

export interface DeleteDocumentWorkParams {
  agentDocumentId?: string | null;
  agentId?: string | null;
  documentId: string;
}

export interface DeleteTaskWorkParams {
  /** Internal task id (`works.resourceId` for `resourceType: 'task'`). */
  taskId: string;
}

export interface RegisterLinearWorkParams {
  actorAgentId?: string | null;
  assignee?: string | null;
  assigneeId?: string | null;
  color?: string | null;
  content?: string | null;
  createdAt?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  dueDate?: string | null;
  icon?: string | null;
  issueId?: string | null;
  issueIdentifier?: string | null;
  labels?: string[];
  parentId?: string | null;
  patchFields?: LinearWorkPatchField[];
  priority?: string | null;
  priorityValue?: number | null;
  project?: string | null;
  projectId?: string | null;
  resourceId: string;
  resourceIdentifier?: string | null;
  resourceType: LinearWorkResourceType;
  role: WorkVersionRole;
  rootOperationId?: string | null;
  slugId?: string | null;
  source: string;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  status?: string | null;
  statusType?: string | null;
  targetId?: string | null;
  targetIdentifier?: string | null;
  targetType?: LinearWorkEntityType | 'initiative' | 'milestone' | 'project' | null;
  team?: string | null;
  teamId?: string | null;
  threadId?: string | null;
  title?: string | null;
  topicId?: string | null;
  updatedAt?: string | null;
  url?: string | null;
}

export interface RegisterGithubWorkParams {
  actorAgentId?: string | null;
  assignees?: string[];
  author?: string | null;
  baseRef?: string | null;
  body?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  draft?: boolean | null;
  headRef?: string | null;
  labels?: string[];
  merged?: boolean | null;
  mergedAt?: string | null;
  number?: number | null;
  patchFields?: GithubWorkPatchField[];
  repo?: string | null;
  resourceId: string;
  resourceIdentifier?: string | null;
  resourceType: GithubWorkResourceType;
  role: WorkVersionRole;
  rootOperationId?: string | null;
  source: string;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  state?: string | null;
  stateReason?: string | null;
  threadId?: string | null;
  title?: string | null;
  topicId?: string | null;
  updatedAt?: string | null;
  url?: string | null;
}

/**
 * LobeHub Skill providers whose tool results are adapted into the Work
 * registry. Client executors and the server BuiltinToolsExecutor both gate on
 * this list before calling `handleSkillToolResult`.
 */
export const WORK_SKILL_PROVIDERS = ['github', 'linear'] as const;
export type WorkSkillProvider = (typeof WORK_SKILL_PROVIDERS)[number];

export const isWorkSkillProvider = (provider?: string | null): provider is WorkSkillProvider =>
  !!provider && (WORK_SKILL_PROVIDERS as readonly string[]).includes(provider);

export interface RegisterSkillToolResultWorkParams {
  actorAgentId?: string | null;
  args?: Record<string, unknown>;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  data?: unknown;
  provider: string;
  rootOperationId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  threadId?: string | null;
  toolName: string;
  topicId?: string | null;
}

export type RegisterLinearToolResultWorkParams = Omit<
  RegisterSkillToolResultWorkParams,
  'provider'
>;

export type RegisterGithubToolResultWorkParams = Omit<
  RegisterSkillToolResultWorkParams,
  'provider'
>;

export interface RegisterTaskWorkParams {
  actorAgentId?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  role: WorkVersionRole;
  rootOperationId?: string | null;
  source: string;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  taskId?: string;
  taskIdentifier?: string;
  threadId?: string | null;
  topicId?: string | null;
}

/** One resolved task Work target extracted from a tool result / args. */
export interface WorkTaskTarget {
  taskId?: string;
  taskIdentifier?: string;
}

/**
 * Registration intent emitted by the tool-execution layer (`BuiltinToolsExecutor`,
 * document runtime) and consumed by the agent runtime (`callTool` /
 * `callToolsBatch`) once the tool call's cumulative cost is known, so the Work
 * version is inserted ONCE carrying its `cumulativeCost` instead of created
 * cost-less and back-filled by a second UPDATE.
 *
 * Carries only the type-specific resource identity; the runtime supplies
 * provenance (operation / message / tool-call ids, thread / topic, actor agent)
 * and the cumulative usage snapshot at persist time. The `skill` variant also
 * carries the tool's UNTRUNCATED result payload (`data`), because the runtime
 * only ever sees the truncated `content` — the identity fields (issue/PR url,
 * number, …) live exclusively in the raw payload.
 */
export type WorkRegistrationIntent =
  | {
      action: 'create' | 'update' | 'delete';
      role?: WorkVersionRole;
      targets: WorkTaskTarget[];
      type: 'task';
    }
  | {
      args?: Record<string, unknown>;
      data: unknown;
      provider: string;
      toolName: string;
      type: 'skill';
    }
  | {
      action: 'register';
      document: {
        agentDocumentId?: string | null;
        agentId?: string | null;
        description?: string | null;
        documentId: string;
        role: WorkVersionRole;
        source: string;
        url?: string | null;
      };
      type: 'document';
    }
  | {
      action: 'delete';
      document: { agentDocumentId?: string | null; agentId?: string | null; documentId: string };
      type: 'document';
    };
