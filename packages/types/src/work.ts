import type { GoalReportMetadata } from './goalReport';
import type { TaskStatus } from './task';

/**
 * `goal_report` is the wrap-up report of a Goal: one Work per goal, a new
 * version per acceptance result. It is read through the goal graph, not the
 * generic Work lists.
 */
export type WorkType =
  'artboard' | 'canvas' | 'document' | 'external' | 'file' | 'collection' | 'goal_report' | 'task';
/** Work types the generic Work lists return; a `goal_report` is read through its goal. */
export type ListedWorkType = Exclude<WorkType, 'goal_report'>;
export type LinearWorkResourceType = 'linear_document' | 'linear_issue';
export type GithubWorkResourceType = 'github_issue' | 'github_pull_request';
/**
 * A plain http(s) link an agent registered itself (`lh work create --url`), such
 * as a deployed site or a design file. Its resource identity is the normalized
 * URL. GitHub and Linear links are registered automatically under their own
 * resource types and are never stored as `link`.
 */
export type LinkWorkResourceType = 'link';
/** Every resource type backed by the unified `external` Work type. */
export type ExternalWorkResourceType =
  GithubWorkResourceType | LinearWorkResourceType | LinkWorkResourceType;
export type WorkResourceType =
  | 'artboard'
  | 'canvas'
  | 'document'
  | ExternalWorkResourceType
  | 'file'
  | 'collection'
  | 'goal_report'
  | 'task';
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

/**
 * Server-written Agent Share provenance on a `works` row. Mirrors the
 * document/file provenance: a Work registered by a share visitor's run stays
 * owned by the CREATOR (the run executes under their account) but is fenced
 * off from the creator's ordinary Work surfaces and served back only to the
 * visitor's own share topic.
 */
export interface AgentShareWorkProvenance {
  shareId: string;
  topicId: string;
  visitorUserId: string;
}

export interface CanvasWorkPublishMetadata {
  deploymentId: string;
  publishedVersion: number;
}

export interface ArtboardWorkPublishMetadata {
  deploymentId: string;
  publishedRevision: number;
  publisherUserId: string;
  snapshotHash: string;
}

export interface WorkMetadata {
  /**
   * The agent may change this Work later through `lh work update`. Stamped once
   * when the Work identity is first registered and never changed afterwards:
   * Works collected automatically (completion scans, skill results, manifest
   * `work` configs without `agentEditable`) leave it unset and stay read-only
   * to the agent.
   */
  agentEditable?: boolean;
  agentShare?: AgentShareWorkProvenance;
  artboardPublish?: ArtboardWorkPublishMetadata;
  canvasPublish?: CanvasWorkPublishMetadata;
}

/**
 * Explicit read/write boundary for the Work registry, same shape as
 * `DocumentAccessScope`: `ordinary` sees only rows WITHOUT share provenance;
 * `agentShare` sees only rows stamped with exactly this share/topic/visitor.
 */
export type WorkAccessScope =
  ({ type: 'agentShare' } & AgentShareWorkProvenance) | { type: 'ordinary' };

export const ordinaryWorkAccessScope = {
  type: 'ordinary',
} as const satisfies WorkAccessScope;

export const agentShareWorkAccessScope = (
  provenance: AgentShareWorkProvenance,
): WorkAccessScope => ({
  shareId: provenance.shareId,
  topicId: provenance.topicId,
  type: 'agentShare',
  visitorUserId: provenance.visitorUserId,
});

export interface CanvasPublishFile {
  content: string;
  contentType: string;
  encoding: 'base64' | 'utf8';
  path: string;
}

export interface CanvasPublishBundle {
  files: CanvasPublishFile[];
  html: string;
}

export interface CanvasWorkVersionMetadata {
  entry: string;
  fileCount: number;
  manifestKey: string;
  runtimeMajor: number;
  totalSize: number;
}

/**
 * Storage one Canvas holds in the caller's file usage: every distinct blob
 * registered under the canvas across all its versions. The canvas is the unit
 * a user can free — its files only render together, so they are never listed
 * or deleted one by one.
 */
export interface CanvasStorageItem {
  canvasId: string;
  fileCount: number;
  /** `null` when the files outlived their Work (the save never registered one). */
  title: string | null;
  totalSize: number;
  updatedAt: Date;
  workId: string | null;
}

/** One image of a `collection` Work, in display order. */
export interface CollectionWorkItem {
  caption?: string;
  /** The image's file-store id; the server checks the run owns it. */
  fileId: string;
  mimeType?: string;
  /** Durable URL of the image (`/f/<fileId>`), resolved by the server. */
  url: string;
}

/**
 * `collection` Work — the complete image list of this version. Every version
 * carries the full list: an update replaces it, never patches it.
 */
export interface CollectionWorkVersionMetadata {
  /** File id of the cover image; the first image when unset. */
  coverFileId?: string;
  items: CollectionWorkItem[];
}

export interface WorkVersionMetadata {
  agentDocumentId?: string;
  /** `external` GitHub PR Work — the branch the pull request merges into. */
  baseBranch?: string;
  canvas?: CanvasWorkVersionMetadata;
  collection?: CollectionWorkVersionMetadata;
  /**
   * `file` Work — the edited file's identity in the file store, when the entity
   * file was persisted. `filePath` is always present for a file Work; the
   * remaining fields are populated only once the file is registered/uploaded.
   */
  fileId?: string;
  /** `file` Work — the edited file's path within the operation (its resource identity). */
  filePath?: string;
  /** `file` Work — size in bytes of the edited file. */
  fileSize?: number;
  /** `file` Work — durable, fetchable URL of the persisted file. */
  fileUrl?: string;
  /** `goal_report` Work — the structured storyline; the full report is the version's `content`. */
  goalReport?: GoalReportMetadata;
  /** `goal_report` Work — the report as an HTML page: a `custom/html` document id. */
  goalReportPageId?: string;
  /**
   * `external` GitHub PR Work — the pull request's source branch as the tool
   * named it: REST `head.ref` is the bare branch, while `gh --head` may carry
   * `owner:branch` for a fork.
   */
  headBranch?: string;
  /** `file` Work — lines added by this version's edit (0 when the source tool reports none). */
  linesAdded?: number;
  /** `file` Work — lines deleted by this version's edit (0 when the source tool reports none). */
  linesDeleted?: number;
  /** `file` Work — MIME type of the edited file. */
  mimeType?: string;
  /**
   * `external` GitHub PR Work — how this version linked the PR: `command` when
   * a command named it, `push` for a `git push` to a branch that already had
   * it. Set on every version, since metadata merges over the previous one.
   */
  pullRequestLink?: 'command' | 'push';
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
  /**
   * The live resource row backing this Work (the task / the document) no longer
   * exists. It was deleted outside the tool-dispatch path, which deliberately
   * orphans the Work rather than removing it (see `models/work/context.ts`), so
   * the card renders from its version snapshot and opening it would 404 — the
   * UI shows a "resource deleted" badge and offers removal instead.
   *
   * Derived per query from a LEFT JOIN miss on the backing table, never
   * persisted. Always `false` for `external` and `file` Works: they have no
   * local backing row that could go missing.
   */
  resourceDeleted: boolean;
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

/**
 * A file Work: an entity-format file (pptx/xlsx/docx/pdf, …) edited during an
 * operation. Its resource identity is `${userId}:${topicId}:${filePath}` (the
 * sandbox is per user+topic, so file identity intrinsically includes the user).
 * Its display columns come entirely from the `works` row — the per-version file
 * identity (path, fileId, url, line deltas) lives in {@link WorkVersionMetadata}.
 * Fully display-backed like document/external (no live table join).
 */
export interface FileWorkListItem extends WorkListBaseItem {
  resourceType: 'file';
  type: 'file';
}

export interface CanvasWorkListItem extends WorkListBaseItem {
  resourceType: 'canvas';
  type: 'canvas';
}

export interface ArtboardWorkListItem extends WorkListBaseItem {
  resourceType: 'artboard';
  type: 'artboard';
}

/**
 * A set of images an agent collected into one Work (the `lobe-work` tool). Its
 * resource id is a generated `col_` id, so every create is a new collection. The
 * `works.url` column holds the cover image URL for list rows; the image list
 * lives in {@link CollectionWorkVersionMetadata}.
 */
export interface CollectionWorkListItem extends WorkListBaseItem {
  resourceType: 'collection';
  type: 'collection';
}

export type WorkListItem =
  | ArtboardWorkListItem
  | CanvasWorkListItem
  | DocumentWorkListItem
  | ExternalWorkListItem
  | FileWorkListItem
  | CollectionWorkListItem
  | TaskWorkListItem;

export interface TaskWorkVersionEventItem extends TaskWorkListItem {
  version: WorkVersionPreview;
}

export interface DocumentWorkVersionEventItem extends DocumentWorkListItem {
  version: WorkVersionPreview;
}

export interface ExternalWorkVersionEventItem extends ExternalWorkListItem {
  version: WorkVersionPreview;
}

export interface FileWorkVersionEventItem extends FileWorkListItem {
  version: WorkVersionPreview;
}

export interface CanvasWorkVersionEventItem extends CanvasWorkListItem {
  version: WorkVersionPreview;
}

export interface ArtboardWorkVersionEventItem extends ArtboardWorkListItem {
  version: WorkVersionPreview;
}

export interface CollectionWorkVersionEventItem extends CollectionWorkListItem {
  version: WorkVersionPreview;
}

export type WorkVersionEventItem =
  | ArtboardWorkVersionEventItem
  | CanvasWorkVersionEventItem
  | DocumentWorkVersionEventItem
  | ExternalWorkVersionEventItem
  | FileWorkVersionEventItem
  | CollectionWorkVersionEventItem
  | TaskWorkVersionEventItem;
export type WorkVersionEventMap = Record<string, WorkVersionEventItem[]>;

export type WorkSummaryVersionPreview = WorkVersionPreview &
  Pick<WorkVersionItem, 'cumulativeUsage'>;

export interface TaskWorkSummaryItem extends TaskWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface DocumentWorkSummaryItem extends DocumentWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface ExternalWorkSummaryItem extends ExternalWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface FileWorkSummaryItem extends FileWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface CanvasWorkSummaryItem extends CanvasWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface ArtboardWorkSummaryItem extends ArtboardWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export interface CollectionWorkSummaryItem extends CollectionWorkListItem {
  event: WorkSummaryVersionPreview;
  totalCost: number | null;
  version: Pick<WorkVersionItem, 'createdAt' | 'id' | 'version'> | null;
}

export type WorkSummaryItem =
  | ArtboardWorkSummaryItem
  | CanvasWorkSummaryItem
  | DocumentWorkSummaryItem
  | ExternalWorkSummaryItem
  | FileWorkSummaryItem
  | CollectionWorkSummaryItem
  | TaskWorkSummaryItem;
export type WorkSummaryMap = Record<string, WorkSummaryItem[]>;

export interface RegisterDocumentWorkParams {
  agentDocumentId?: string | null;
  /**
   * Stamp the Work as agent-editable when this registration creates it. Ignored
   * when the Work already exists: editability is fixed at creation. See
   * {@link WorkMetadata.agentEditable}.
   */
  agentEditable?: boolean | null;

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

/**
 * Register (or add a version to) a `file` Work — an entity-format file
 * (pptx/xlsx/docx/pdf, …) edited during an operation. Its resource identity is
 * `${userId}:${topicId}:${filePath}`, so re-editing the same file in a later
 * operation adds a version to the same Work. The card shows only the basename
 * `title`; the per-version file identity (fileId / url / mime / size / line
 * deltas) rides in {@link WorkVersionMetadata}.
 *
 * `changeType` is NOT part of the params: the DB layer derives it from whether
 * the Work already exists (first registration → `created`, any later one →
 * `updated`).
 */
export interface RegisterFileWorkParams {
  /**
   * Stamp the Work as agent-editable when this registration creates it. Ignored
   * when the Work already exists: editability is fixed at creation. See
   * {@link WorkMetadata.agentEditable}.
   */
  agentEditable?: boolean | null;
  agentId?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  /** Card description; defaults to `filePath`. */
  description?: string | null;
  /** The edited file's path within the operation — half of the resource identity. */
  filePath: string;
  messageId?: string | null;
  /** Per-version file identity + line deltas persisted into the version metadata. */
  metadata: WorkVersionMetadata;
  rootOperationId?: string | null;
  threadId?: string | null;
  /** Card title — the edited file's basename. */
  title: string;
  /** Dedup key for one-version-per-operation (`op:${operationId}`). */
  toolCallId?: string | null;
  /** Tool/plugin identifier that produced this version. */
  toolIdentifier: string;
  toolName: string;
  /** Owning topic; combined with `filePath` into the Work resource identity. */
  topicId: string;
  userId: string;
  /** Defaults to `private` when omitted — edited files are user-private. */
  visibility?: WorkVisibility;
}

export interface RegisterCanvasWorkParams {
  agentId?: string | null;
  canvasId: string;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  /** Checked under the Work row lock; 0 means this must be the first version. */
  expectedVersion?: number;
  messageId?: string | null;
  metadata: CanvasWorkVersionMetadata;
  rootOperationId?: string | null;
  threadId?: string | null;
  title: string;
  toolCallId?: string | null;
  toolIdentifier: string;
  toolName: string;
  topicId?: string | null;
  visibility?: WorkVisibility;
}

export interface RegisterArtboardWorkParams {
  agentId?: string | null;
  artboardId: string;
  changeType: WorkVersionChangeType;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  messageId?: string | null;
  projectId?: string | null;
  rootOperationId?: string | null;
  threadId?: string | null;
  title: string;
  toolCallId?: string | null;
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

/**
 * User-initiated removal of one Work card, addressed by the Work's own id
 * rather than a backing resource — the resource is typically already gone (see
 * {@link WorkListBaseItem.resourceDeleted}), which is exactly why the user has
 * no other way to clear the card.
 */
export interface DeleteWorkParams {
  /** `works.id` of the card to remove. */
  id: string;
}

export interface RegisterExternalWorkParams {
  /**
   * Stamp the Work as agent-editable when this registration creates it. Ignored
   * when the Work already exists: editability is fixed at creation. See
   * {@link WorkMetadata.agentEditable}.
   */
  agentEditable?: boolean | null;
  agentId?: string | null;
  changeType: WorkVersionChangeType;
  /** Full body captured in the next version when named in `patchFields`. */
  content?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  description?: string | null;
  identifier?: string | null;
  messageId?: string | null;
  /**
   * Provider facts outside the display columns (a PR's branches). With
   * `patchFields`, keys merge over the current version's metadata, so an edit
   * that names no branch keeps the one captured at create.
   */
  metadata?: WorkVersionMetadata | null;
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
  /**
   * Stamp the Work as agent-editable when this registration creates it. Ignored
   * when the Work already exists: editability is fixed at creation. See
   * {@link WorkMetadata.agentEditable}.
   */
  agentEditable?: boolean | null;
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
      /** From the API's `work.agentEditable`; see {@link WorkMetadata.agentEditable}. */
      agentEditable?: boolean;
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
        /** From the API's `work.agentEditable`; see {@link WorkMetadata.agentEditable}. */
        agentEditable?: boolean;
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
    }
  | {
      action: 'register';
      canvas: {
        canvasId: string;
        description?: string | null;
        metadata: CanvasWorkVersionMetadata;
        title: string;
        toolName: string;
      };
      type: 'canvas';
    }
  | {
      action: 'register';
      artboard: {
        artboardId: string;
        changeType: WorkVersionChangeType;
        description?: string | null;
        projectId?: string | null;
        title: string;
        toolName: string;
      };
      type: 'artboard';
    };

/**
 * How a pull request came to be linked to a topic, strongest first:
 *
 * - `created` — the topic's agent opened it (`gh pr create`).
 * - `command` — the agent ran a command naming it (`gh pr edit|ready|merge <n>`).
 * - `push` — the agent pushed to a branch that already had it.
 * - `branch` — found on a branch the topic created (run-end lookup).
 * - `manual` — the person linked it by URL.
 *
 * The first three are Work rows the server parsed from the run's own tool
 * messages; `branch` and `manual` are topic links that only drive the UI.
 */
export type TopicPullRequestLinkSource = 'branch' | 'command' | 'created' | 'manual' | 'push';

/**
 * A link kept on the topic itself (`metadata.pullRequests.links`) rather than
 * as a Work row: a PR found on the topic's own branch, or linked by hand.
 * Written only by the server's link endpoints.
 */
export interface TopicPullRequestLinkMeta {
  headRefName?: string;
  /** `owner/repo#number`. */
  identifier: string;
  /** ISO time it was linked. */
  linkedAt: string;
  source: 'branch' | 'manual';
  title?: string;
  url: string;
  /** See {@link TopicPullRequestItem.vouched}. */
  vouched: boolean;
}

/** Topic-level PR links and the PRs a person removed from the topic's lists. */
export interface TopicPullRequestsMeta {
  /** `owner/repo#number` hidden from the topic; the Work rows stay. */
  dismissed?: string[];
  links?: TopicPullRequestLinkMeta[];
}

/**
 * One GitHub pull request linked to a topic: by any
 * `work_versions` row of a `github_pull_request` Work with that `topicId`, or by
 * a topic link (branch match / by hand). A topic can carry several.
 */
export interface TopicPullRequestWork {
  baseBranch?: string;
  headBranch?: string;
  /** `owner/repo#number`. */
  identifier: string;
  /** Newest version of this Work registered in the topic. */
  linkedAt: Date;
  number: number;
  repoFullName: string;
  /** See {@link TopicPullRequestLinkSource}. */
  source: TopicPullRequestLinkSource;
  /** Status the agent's own commands left it in (`open`, `draft`, `merged`). */
  status: string | null;
  title: string | null;
  url: string | null;
  /** Null for a topic link with no Work row. */
  workId: string | null;
}

/**
 * What the GitHub App last reported about a linked pull request. Present only
 * when an installation the viewer can see tracks the repository — that is the
 * confirmed source; without it the client probes the execution device.
 */
/**
 * The pull request's Auto-fix: whether its failing CI and review feedback
 * wake the agent of {@link ownerTopicId}. Only that conversation may switch it.
 */
export interface TopicPullRequestAutoFix {
  changeRequestId: string;
  enabled: boolean;
  /** Wakes allowed before Auto-fix stops on its own; turning it back on starts over. */
  maxWakes: number;
  /** The conversation it wakes, when it is not this one and the viewer can open it. */
  ownerTopic: { agentId: string | null; id: string; title: string | null } | null;
  /** The conversation it wakes; `null` when none is linked. */
  ownerTopicId: string | null;
  wakeCount: number;
}

export interface TopicPullRequestScmState {
  autoFix: TopicPullRequestAutoFix;
  ciStatus: 'failure' | 'pending' | 'success' | 'unknown' | null;
  isDraft: boolean;
  mergedAt: Date | null;
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
  state: 'closed' | 'merged' | 'open';
  title: string | null;
  updatedAt: Date;
}

export interface TopicPullRequestItem extends TopicPullRequestWork {
  scm: TopicPullRequestScmState | null;
  /**
   * Whether the app can vouch this PR belongs to the topic: the run's own
   * commands named it, the person linked it, or the branch match found its head
   * in the repository the topic pushes to. An unvouched PR is listed but its
   * merge / close stay locked.
   */
  vouched: boolean;
}

/** Tool identity stamped on Work versions written by `lh work create|update`. */
export const AGENT_WORK_CLI_TOOL_IDENTIFIER = 'lobehub-cli';

/**
 * What an agent registers itself as a Work: a file it produced (already
 * uploaded to the file store), a plain http(s) link, or a collection of images it
 * collected.
 */
export type CreateAgentWorkInput =
  | {
      description?: string;
      file: {
        fileId: string;
        /** Absolute path of the produced file; with the topic it forms the Work identity. */
        filePath: string;
        fileSize?: number;
        fileUrl?: string;
        mimeType?: string;
      };
      title?: string;
      type: 'file';
    }
  | {
      description?: string;
      title: string;
      type: 'link';
      url: string;
    }
  | ({
      description?: string;
      title: string;
      type: 'collection';
    } & CollectionWorkVersionMetadata);

/**
 * A new version of an agent-created Work. Fields left out keep the current
 * version's values. `file` applies to file Works and `collection` to collection
 * Works, where it replaces the whole image list. A link Work's URL is its
 * identity and does not change; a new link is a new Work.
 */
export interface UpdateAgentWorkInput {
  collection?: CollectionWorkVersionMetadata;
  description?: string;
  file?: Omit<Extract<CreateAgentWorkInput, { type: 'file' }>['file'], 'filePath'>;
  title?: string;
  workId: string;
}

/** The run an agent Work is registered from, resolved server-side from its operation. */
export interface AgentWorkRunContext {
  agentId?: string | null;
  /** The assistant message of the tool call, when a builtin tool (not the CLI) writes. */
  messageId?: string | null;
  operationId: string;
  /**
   * Top of the operation tree `operationId` runs in, stamped on versions as
   * `rootOperationId` so run completion can fill their cost. Defaults to
   * `operationId`.
   */
  rootOperationId?: string;
  threadId?: string | null;
  /** Tool call id of a builtin-tool write; a retried call does not add a second version. */
  toolCallId?: string | null;
  /** Defaults to {@link AGENT_WORK_CLI_TOOL_IDENTIFIER}. */
  toolIdentifier?: string;
  topicId: string;
  userId: string;
}

/** Most images one collection Work holds. */
export const COLLECTION_WORK_MAX_ITEMS = 50;
