import type { TaskStatus } from './task';

export type WorkType = 'document' | 'external' | 'task';
export type LinearWorkResourceType = 'linear_document' | 'linear_issue';
export type GithubWorkResourceType = 'github_issue' | 'github_pull_request';
/** Every resource type backed by the unified `external` Work type. */
export type ExternalWorkResourceType = GithubWorkResourceType | LinearWorkResourceType;
export type WorkResourceType = 'document' | ExternalWorkResourceType | 'task';
export type WorkVisibility = 'private' | 'public';
/**
 * How a version changed the Work. Not derivable from `version === 1`: updating
 * an external resource that was never registered before yields a v1 row with
 * changeType='updated'.
 */
export type WorkVersionChangeType = 'created' | 'updated';

/**
 * The display fields captured by every immutable Work version. A partial tool
 * result (e.g. Linear `{ id, state }`) names only the fields it carries in
 * `patchFields`; registration merges them with the current version before
 * inserting the next complete snapshot.
 */
export type WorkDisplayField =
  'content' | 'description' | 'identifier' | 'status' | 'title' | 'url';

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
  /** Denormalized current-version preview used by Work list queries. */
  description: string | null;
  id: string;
  /** Denormalized current-version human reference. */
  identifier: string | null;
  /** Agent that first registered this Work; stamped once at creation, immutable. */
  originAgentId: string | null;
  /** Thread where this Work was first registered; stamped once at creation, immutable. */
  originThreadId: string | null;
  /** Topic where this Work was first registered; stamped once at creation, immutable. */
  originTopicId: string | null;
  resourceId: string | null;
  resourceType: WorkResourceType;
  /** Denormalized current-version resource status. */
  status: string | null;
  /** Denormalized current-version title used by Work list queries. */
  title: string | null;
  /** Tool/plugin identifier that produced the current version. */
  toolIdentifier: string;
  /** Concrete tool that produced the current version. */
  toolName: string;
  type: WorkType;
  updatedAt: Date;
  /** Denormalized current-version canonical open target. */
  url: string | null;
  userId: string;
  /** Workspace visibility mirrored from the backing resource; external Works are private. */
  visibility: WorkVisibility;
  workspaceId: string | null;
}

/** Card/list payload shared by conversation history, message chips, and the workspace gallery. */
export type WorkListBaseItem = WorkItem & {
  /**
   * Title of the origin topic, joined for grouping the workspace gallery by
   * conversation. Populated only by the workspace list query; `null` when the
   * origin topic was deleted (originTopicId is set-null) or never stamped.
   */
  originTopicTitle?: string | null;
};

export interface WorkVersionItem {
  /** Agent that produced this version. */
  agentId: string | null;
  changeType: WorkVersionChangeType;
  /** Full text captured by this version. Null for document Works. */
  content: string | null;
  createdAt: Date;
  cumulativeCost: number | null;
  cumulativeUsage: WorkVersionCumulativeUsage | null;
  /** Short preview text captured by this version. */
  description: string | null;
  id: string;
  /** Short human reference captured by this version. */
  identifier: string | null;
  /** Persisted tool-result message that triggered this version. */
  messageId: string | null;
  metadata: WorkVersionMetadata | null;
  rootOperationId: string | null;
  /** Resource status captured by this version. */
  status: string | null;
  threadId: string | null;
  /** Display title captured by this version. */
  title: string | null;
  /** Runtime tool-call id used to deduplicate repeated registration. */
  toolCallId: string | null;
  /** Tool/plugin identifier that produced THIS version (per-mutation). */
  toolIdentifier: string;
  /** Concrete tool that produced this version, e.g. 'createTask'. */
  toolName: string;
  topicId: string | null;
  /** Canonical http(s) open target captured by this version. */
  url: string | null;
  version: number;
  workId: string;
}

/** Version fields embedded in Work list rows (the mutation event that surfaced the Work). */
export type WorkVersionPreview = Pick<
  WorkVersionItem,
  | 'createdAt'
  | 'cumulativeCost'
  | 'id'
  | 'metadata'
  | 'changeType'
  | 'rootOperationId'
  | 'messageId'
  | 'toolCallId'
  | 'toolName'
  | 'version'
>;

export interface TaskWorkListItem extends WorkListBaseItem {
  resourceType: 'task';
  task: {
    /** Short reference (`TASK-1`), live-coalesced like the other fields; card display + open target. */
    identifier: string | null;
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

export interface DocumentWorkListItem extends WorkListBaseItem {
  resourceType: 'document';
  type: 'document';
}

export interface ExternalWorkListItem extends WorkListBaseItem {
  resourceType: ExternalWorkResourceType;
  type: 'external';
}

export type WorkListItem = DocumentWorkListItem | ExternalWorkListItem | TaskWorkListItem;

export interface TaskWorkVersionEventItem extends TaskWorkListItem {
  version: WorkVersionPreview;
}

export interface DocumentWorkVersionEventItem extends DocumentWorkListItem {
  version: WorkVersionPreview;
}

export interface ExternalWorkVersionEventItem extends ExternalWorkListItem {
  version: WorkVersionPreview;
}

export type WorkVersionEventItem =
  DocumentWorkVersionEventItem | ExternalWorkVersionEventItem | TaskWorkVersionEventItem;
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

export interface ExternalWorkSummaryItem extends ExternalWorkListItem {
  event: WorkVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export type WorkSummaryItem =
  DocumentWorkSummaryItem | ExternalWorkSummaryItem | TaskWorkSummaryItem;
export type WorkSummaryMap = Record<string, WorkSummaryItem[]>;

export interface RegisterDocumentWorkParams {
  agentDocumentId?: string | null;
  /** Agent that produced this version; also validates the agent-document binding when present. */
  agentId?: string | null;
  changeType: WorkVersionChangeType;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  documentId: string;
  messageId?: string | null;
  rootOperationId?: string | null;
  threadId?: string | null;
  toolCallId?: string | null;
  /** Tool/plugin identifier that produced this version. */
  toolIdentifier: string;
  toolName: string;
  topicId?: string | null;
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

export interface RegisterExternalWorkParams {
  agentId?: string | null;
  changeType: WorkVersionChangeType;
  /** Full body captured in the next version when named in `patchFields`. */
  content?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  identifier?: string | null;
  messageId?: string | null;
  patchFields?: WorkDisplayField[];
  /**
   * Canonical resource identity (`owner/repo#number`, a linear id, …). Required:
   * every normalizer resolves it before registering, so there is no partial
   * `Omit<…, 'resourceId'>` intermediate shape.
   */
  resourceId: string;
  resourceType: ExternalWorkResourceType;
  rootOperationId?: string | null;
  status?: string | null;
  threadId?: string | null;
  title?: string | null;
  toolCallId?: string | null;
  /** Tool/plugin identifier that produced this version. */
  toolIdentifier: string;
  toolName: string;
  topicId?: string | null;
  url?: string | null;
}

/**
 * LobeHub Skill providers whose tool results are adapted into the Work
 * registry. Single source of truth: it gates `handleSkillToolResult` (client
 * executors + server BuiltinToolsExecutor), keys the DB normalizer registry
 * (`SKILL_TOOL_RESULT_NORMALIZERS`), keys `WORK_PROVIDER_RESOURCE_TYPES`, and
 * drives the WorkGallery provider list filters.
 *
 * Adding a provider = extend this list + `WORK_PROVIDER_RESOURCE_TYPES` below +
 * add one normalizer in the DB registry.
 */
export const WORK_SKILL_PROVIDERS = ['github', 'linear'] as const;
export type WorkSkillProvider = (typeof WORK_SKILL_PROVIDERS)[number];

export const isWorkSkillProvider = (provider?: string | null): provider is WorkSkillProvider =>
  !!provider && (WORK_SKILL_PROVIDERS as readonly string[]).includes(provider);

/**
 * The `external` resource types each skill provider owns. Single source of
 * truth for the provider ⇄ resourceType relationship: the workspace list filter
 * narrows by provider through this map, and `workProviderOfResourceType` derives
 * the reverse lookup from it (never a second hand-written map).
 */
export const WORK_PROVIDER_RESOURCE_TYPES: Record<
  WorkSkillProvider,
  readonly ExternalWorkResourceType[]
> = {
  github: ['github_issue', 'github_pull_request'],
  linear: ['linear_document', 'linear_issue'],
};

/** Reverse lookup of `WORK_PROVIDER_RESOURCE_TYPES`, built once at module scope. */
const RESOURCE_TYPE_TO_PROVIDER = new Map<string, WorkSkillProvider>(
  (
    Object.entries(WORK_PROVIDER_RESOURCE_TYPES) as [WorkSkillProvider, readonly string[]][]
  ).flatMap(([provider, resourceTypes]) =>
    resourceTypes.map((resourceType) => [resourceType, provider]),
  ),
);

/** Which skill provider owns an `external` resource type, or `undefined`. */
export const workProviderOfResourceType = (resourceType: string): WorkSkillProvider | undefined =>
  RESOURCE_TYPE_TO_PROVIDER.get(resourceType);

export interface RegisterSkillToolResultWorkParams {
  agentId?: string | null;
  args?: Record<string, unknown>;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  data?: unknown;
  messageId?: string | null;
  provider: string;
  rootOperationId?: string | null;
  threadId?: string | null;
  toolCallId?: string | null;
  toolName: string;
  topicId?: string | null;
}

/** Provider-agnostic normalizer input: a skill tool result minus its provider tag. */
export type SkillToolResultWorkInput = Omit<RegisterSkillToolResultWorkParams, 'provider'>;

export interface RegisterTaskWorkParams {
  agentId?: string | null;
  changeType: WorkVersionChangeType;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  messageId?: string | null;
  rootOperationId?: string | null;
  taskId?: string;
  taskIdentifier?: string;
  threadId?: string | null;
  toolCallId?: string | null;
  /** Tool/plugin identifier that produced this version. */
  toolIdentifier: string;
  toolName: string;
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
 * provenance (operation / message / tool-call ids, thread / topic, agent)
 * and the cumulative usage snapshot at persist time. The `skill` variant also
 * carries the tool's UNTRUNCATED result payload (`data`), because the runtime
 * only ever sees the truncated `content` — the identity fields (issue/PR url,
 * number, …) live exclusively in the raw payload.
 */
export type WorkRegistrationIntent =
  | {
      action: 'create' | 'update' | 'delete';
      changeType?: WorkVersionChangeType;
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
        changeType: WorkVersionChangeType;
        toolName: string;
      };
      type: 'document';
    }
  | {
      action: 'delete';
      document: { agentDocumentId?: string | null; agentId?: string | null; documentId: string };
      type: 'document';
    };
