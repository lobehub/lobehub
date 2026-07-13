import type { TaskStatus } from './task';

export type WorkType = 'document' | 'external' | 'task';
export type LinearWorkResourceType = 'linear_document' | 'linear_issue';
export type GithubWorkResourceType = 'github_issue' | 'github_pull_request';
/** Every resource type backed by the unified `external` Work type. */
export type ExternalWorkResourceType = GithubWorkResourceType | LinearWorkResourceType;
export type WorkResourceType = 'document' | ExternalWorkResourceType | 'task';
/**
 * How a version changed the Work. Not derivable from `version === 1`: updating
 * an external resource that was never registered before yields a v1 row with
 * changeType='updated'.
 */
export type WorkVersionChangeType = 'created' | 'updated';

/**
 * The patchable Work display columns (now real columns on the `works` row,
 * unified vocabulary). A partial tool result (e.g. Linear `{ id, state }`) names
 * only the fields it carries in `patchFields`, so a concurrent registration's
 * other columns are never overwritten. Free-text fields (`description`) are
 * sliced at WRITE time; full/live data stays on the owning tables (tasks,
 * documents) or in `works.content`.
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
  /** FULL untruncated text (layer 3). Null for document Works. */
  content: string | null;
  createdAt: Date;
  currentVersionId: string | null;
  /** Short preview text, sliced to 120 chars at write time (layer 2). */
  description: string | null;
  id: string;
  /** Short human reference: `TASK-1`, filename, `ENG-123`, `owner/repo#42`. */
  identifier: string | null;
  resourceId: string | null;
  resourceType: WorkResourceType;
  /** Tool/plugin identifier that CREATED the Work (written once, never overwritten). */
  sourceToolIdentifier: string | null;
  /** Current resource status (external Works only). */
  status: string | null;
  /** Thread where the Work was first registered (creation provenance; null outside a thread). */
  threadId: string | null;
  /** Current display title (layer 1). */
  title: string | null;
  /** Topic where the Work was first registered (creation provenance; null outside a conversation). */
  topicId: string | null;
  type: WorkType;
  updatedAt: Date;
  /** External link (sanitized to http(s) upstream). */
  url: string | null;
  userId: string;
  workspaceId: string | null;
}

export interface WorkVersionItem {
  actorAgentId: string | null;
  changeType: WorkVersionChangeType;
  createdAt: Date;
  cumulativeCost: number | null;
  cumulativeUsage: WorkVersionCumulativeUsage | null;
  id: string;
  metadata: WorkVersionMetadata | null;
  rootOperationId: string | null;
  sourceMessageId: string | null;
  sourceToolCallId: string | null;
  /** Tool/plugin identifier that produced THIS version (per-mutation). */
  sourceToolIdentifier: string | null;
  /** Concrete tool that produced this version, e.g. 'createTask'. */
  sourceToolName: string;
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
  | 'changeType'
  | 'rootOperationId'
  | 'sourceMessageId'
  | 'sourceToolCallId'
  | 'sourceToolName'
  | 'version'
>;

export interface TaskWorkListItem extends WorkItem {
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

export interface DocumentWorkListItem extends WorkItem {
  resourceType: 'document';
  type: 'document';
}

export interface ExternalWorkListItem extends WorkItem {
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
  actorAgentId?: string | null;
  agentDocumentId?: string | null;
  agentId?: string | null;
  changeType: WorkVersionChangeType;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  documentId: string;
  rootOperationId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  /** Tool/plugin identifier that created the Work (stamped once on `works`). */
  sourceToolIdentifier?: string | null;
  sourceToolName: string;
  threadId?: string | null;
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
  actorAgentId?: string | null;
  changeType: WorkVersionChangeType;
  /** FULL untruncated body (layer 3); patched onto `works.content` when named in `patchFields`. */
  content?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  identifier?: string | null;
  patchFields?: WorkDisplayField[];
  /**
   * Canonical resource identity (`owner/repo#number`, a linear id, …). Required:
   * every normalizer resolves it before registering, so there is no partial
   * `Omit<…, 'resourceId'>` intermediate shape.
   */
  resourceId: string;
  resourceType: ExternalWorkResourceType;
  rootOperationId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  /** Tool/plugin identifier that created the Work (stamped once on `works`). */
  sourceToolIdentifier?: string | null;
  sourceToolName: string;
  status?: string | null;
  threadId?: string | null;
  title?: string | null;
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

/** Provider-agnostic normalizer input: a skill tool result minus its provider tag. */
export type SkillToolResultWorkInput = Omit<RegisterSkillToolResultWorkParams, 'provider'>;

export interface RegisterTaskWorkParams {
  actorAgentId?: string | null;
  changeType: WorkVersionChangeType;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  rootOperationId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  /** Tool/plugin identifier that created the Work (stamped once on `works`). */
  sourceToolIdentifier?: string | null;
  sourceToolName: string;
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
        sourceToolName: string;
      };
      type: 'document';
    }
  | {
      action: 'delete';
      document: { agentDocumentId?: string | null; agentId?: string | null; documentId: string };
      type: 'document';
    };
