import type {
  AssistantContentBlock,
  ChatMessageError,
  ChatMessageExtra,
  MessageMetadata,
  TaskDetail,
  UIChatMessage,
  UISignalCallbacksBlock,
  WorkSummaryItem,
} from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import type { VisitorRedactionOptions } from './types';

/**
 * Fields on {@link UIChatMessage} that are safe to forward to an agent-share
 * visitor verbatim: the message's OWN presentational content (text,
 * attachments, tool activity, RAG citations) and structural links WITHIN the
 * same shared topic (thread/group/parent ids). None of these describe the
 * creator's account, billing, or model/provider choice.
 *
 * This is an ALLOWLIST, not a denylist, and that direction is deliberate:
 * `UIChatMessage` is a ~40-field DTO shared with the normal (non-share) chat
 * read path, so new fields land on it regularly as chat features ship. A
 * denylist fails OPEN on every such addition — a new field reaches visitors by
 * default until someone remembers to also strip it here. An allowlist fails
 * CLOSED: a new field is absent from the visitor DTO until a human
 * deliberately adds it below.
 *
 * Deliberately included despite being an id: `agentId` (the visitor already
 * knows which agent they are talking to — that's the whole premise of the
 * share link), `sessionId`/`traceId`/`observationId` (opaque ids scoped to
 * THIS execution of the visitor's OWN turn, reused by client actions such as
 * translate/regenerate that the share UI shares with normal chat).
 */
const VISITOR_MESSAGE_ALLOWED_KEYS = [
  'id',
  'role',
  'content',
  'createdAt',
  'updatedAt',
  'editorData',
  'fileList',
  'files',
  'imageList',
  'videoList',
  'audioList',
  'chunksList',
  'plugin',
  'pluginIntervention',
  'tool_call_id',
  'tools',
  'reasoning',
  'search',
  'ragQuery',
  'ragQueryId',
  'ragRawQuery',
  'parentId',
  'threadId',
  'topicId',
  'groupId',
  'targetId',
  'agentId',
  'sessionId',
  'quotaId',
  'branch',
  'tasks',
  'performance',
  'observationId',
  'traceId',
  'compressedOmittedIds',
  'compressedTurnCount',
] as const satisfies readonly (keyof UIChatMessage)[];

type VisitorAllowedKey = (typeof VISITOR_MESSAGE_ALLOWED_KEYS)[number];

const pickAllowedKeys = (message: UIChatMessage): Pick<UIChatMessage, VisitorAllowedKey> => {
  const picked = {} as Pick<UIChatMessage, VisitorAllowedKey>;
  for (const key of VISITOR_MESSAGE_ALLOWED_KEYS) {
    if (key in message) (picked as Record<string, unknown>)[key] = message[key];
  }
  return picked;
};

/** Keep translate/TTS (visitor-facing rendering), drop the model snapshot. */
const sanitizeVisitorExtra = (extra: ChatMessageExtra | undefined): ChatMessageExtra | undefined =>
  extra ? { translate: extra.translate, tts: extra.tts } : extra;

/**
 * Shape shared by `pinnedMessages` entries and `compareGroup.children` entries
 * (`queryMessageGroupNodes` builds them with this exact narrow projection,
 * then casts the whole node `as unknown as UIChatMessage`, so
 * `UIChatMessage['pinnedMessages']` / `UIChatMessage['children']`'s declared
 * types do not describe them at runtime). Neither carries `sender`/`usage`,
 * only the model snapshot needs stripping.
 *
 * NOTE: on a `compressedGroup` node, `children` is NOT this narrow shape — it
 * lives inside `compressedMessages[].children` (an `AssistantContentBlock[]`
 * produced by `FlatListBuilder`) and carries `usage`, `error`, `tools`,
 * `metadata`, `performance`, and possibly nested `council` messages with
 * `sender`. See `toVisitorMessage` for the recursion that sanitizes those.
 */
interface VisitorGroupSnapshotProjection {
  content: string | null;
  createdAt: Date | number;
  id: string;
  model: string | null;
  provider: string | null;
  role: string;
}

const sanitizeVisitorGroupSnapshots = (
  items: VisitorGroupSnapshotProjection[],
): VisitorGroupSnapshotProjection[] =>
  items.map((item) => ({ ...item, model: null, provider: null }));

/** Cost/token figures are the same class of creator spend data as `usage`. */
const sanitizeVisitorTaskDetail = (taskDetail: TaskDetail | undefined): TaskDetail | undefined => {
  if (!taskDetail) return taskDetail;
  const {
    totalCost: _totalCost,
    totalTokens: _totalTokens,
    totalToolCalls: _totalToolCalls,
    ...rest
  } = taskDetail;
  return rest;
};

/**
 * Key names that identify the CREATOR's model/provider choice or spend/token
 * data wherever they occur inside an unbounded per-tool blob
 * (`pluginState`/`pluginError`, live Gateway event payloads). A builtin tool's
 * server runtime writes whatever shape it wants into `state`/error payloads —
 * e.g. `lobe-agent`'s `analyzeMedia` writes `{ model, provider, usage }`
 * straight into it — so unlike a short, fully enumerable list of top-level
 * `UIChatMessage` fields there is no finite set of "every tool's state shape"
 * to allowlist by hand: a new tool, or a new field on an existing tool's
 * `state`, must be safe BY DEFAULT. Recursing this fixed key set is the
 * fail-closed trade-off.
 */
const CREATOR_PRIVATE_BLOB_KEYS = new Set([
  'model',
  'provider',
  'usage',
  'cost',
  'totalCost',
  'totalTokens',
  'promptTokens',
  'completionTokens',
  'inputTokens',
  'outputTokens',
  // `AgentRuntimeService.publishSubAgentProgress`'s live `step_complete`
  // (`subagent_progress` phase) reads these off `state.usage.llm.tokens` under
  // the `total*` spelling rather than `inputTokens`/`outputTokens` — same
  // class of creator token-spend data, different key name.
  'totalInputTokens',
  'totalOutputTokens',
]);

/**
 * Recursively strip {@link CREATOR_PRIVATE_BLOB_KEYS} from an unbounded
 * JSON-like value at ANY nesting depth. Only descends into plain
 * objects/arrays (`isPlainRecord` already excludes `Date`/`Error`/class
 * instances) — anything else is returned as-is, since it cannot itself carry a
 * nested creator-identity field.
 *
 * Exported so `GatewayStreamNotifier`'s live Gateway-push chokepoint can apply
 * the SAME key set to `stream_start` (`model`/`provider`), `tool_end`
 * (`result`/`payload`, which can carry a tool's `state`), and `step_complete`
 * (`subagent_progress`'s sibling `model`/`totalCost`/token fields) — the live
 * WS payload equivalents of the persisted blobs this function was written for.
 */
export const redactCreatorPrivateBlob = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => redactCreatorPrivateBlob(item)) as T;
  if (!isPlainRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (CREATOR_PRIVATE_BLOB_KEYS.has(key)) continue;
    result[key] = redactCreatorPrivateBlob(nested);
  }
  return result as T;
};

/**
 * `ChatMessageError.type` codes that are safe to forward to a visitor
 * VERBATIM, `message` included — because they are purpose-built,
 * business-level codes whose throw sites already write a clean, generic
 * `message` (never string-concatenated from a raw upstream payload) and whose
 * NAME itself says nothing about the creator's provider/model/account: "this
 * shared agent hit its per-topic turn cap", not "OpenAI rejected key sk-…".
 * Every other code — including the LEGITIMATE quota/rate-limit codes, whose
 * `message`/`body` are still built by `formatErrorForState` from the raw
 * upstream error — is projected to {@link VISITOR_PUBLIC_ERROR_TYPE}. Kept as
 * a narrow allowlist (fail closed) rather than an exclude list of "known
 * provider-identifying codes": some codes leak the provider through the TYPE
 * NAME alone (`OllamaServiceUnavailable`, `InvalidBedrockCredentials`, …), so
 * a denylist would need to enumerate those and would miss the next one a
 * model-runtime change adds.
 */
const VISITOR_SAFE_ERROR_TYPES = new Set<string>([
  ChatErrorType.ShareTurnLimitExceeded,
  ChatErrorType.ShareTopicLimitExceeded,
  ChatErrorType.ShareSpendLimitExceeded,
  ChatErrorType.ShareHeterogeneousAgentUnsupported,
  ChatErrorType.AgentShareProviderNotSupported,
]);

/**
 * Public fallback `type` for any `ChatMessageError` whose code is not in
 * {@link VISITOR_SAFE_ERROR_TYPES}. Reuses the existing generic
 * `AgentRuntimeError` bucket (already localized) rather than minting a new
 * code: the visitor only needs "the run failed, retry or contact the creator",
 * never which of the ~60 specific runtime codes fired.
 */
const VISITOR_PUBLIC_ERROR_TYPE = AgentRuntimeErrorType.AgentRuntimeError;

/**
 * Sanitize a `ChatMessageError` for a visitor — PROJECTION, not the recursive
 * {@link redactCreatorPrivateBlob} used for `pluginState`/`pluginError`.
 * `body` has no stable set of key names to strip: it is free-form per error
 * source and `formatErrorForState` deliberately copies `provider`, `budget`,
 * and the raw upstream diagnostic onto it for exactly the failures a visitor
 * can trigger on demand (bad key, exhausted quota, upstream 500) — so
 * recursing a fixed key set would miss the next shape a new error source
 * introduces. Dropping `body` wholesale and keeping only a classified `type`
 * (+ `message` for the allowlisted codes) fails closed instead: the client
 * re-derives its localized copy, alert styling, and error-card variant from
 * `type` alone.
 *
 * Bypassed entirely when the share sets `showErrorDetails` — the creator has
 * then explicitly opted into showing visitors the raw failure.
 */
export const sanitizeVisitorError = (
  error: ChatMessageError | null | undefined,
  options: VisitorRedactionOptions = {},
): ChatMessageError | null | undefined => {
  if (!error) return error;
  if (options.showErrorDetails) return error;

  const type = error.type as unknown;
  if (typeof type === 'string' && VISITOR_SAFE_ERROR_TYPES.has(type)) {
    return { message: error.message, type: error.type };
  }

  return { type: VISITOR_PUBLIC_ERROR_TYPE };
};

/**
 * `signalCallbacks[].callbacks[]` is a denormalized per-callback snapshot built
 * by `FlatListBuilder`, carrying a bare `model`/`provider` pair per callback
 * turn — same leak class as `pinnedMessages`/`children`'s group-node
 * snapshots.
 */
const sanitizeVisitorSignalCallbacks = (
  signalCallbacks: UISignalCallbacksBlock[] | undefined,
): UISignalCallbacksBlock[] | undefined =>
  signalCallbacks?.map((block) => ({
    ...block,
    callbacks: block.callbacks.map((callback) => ({
      ...callback,
      model: undefined,
      provider: undefined,
    })),
  }));

/**
 * `taskCompletions[]` blocks are denormalized post-task-summary snapshots built
 * by `FlatListBuilder`, each carrying its own `usage` — the same class of
 * creator spend data as the top-level `usage` field.
 */
const sanitizeVisitorTaskCompletions = (
  taskCompletions: AssistantContentBlock[] | undefined,
): AssistantContentBlock[] | undefined =>
  taskCompletions?.map(({ usage: _usage, ...rest }) => rest);

/**
 * `metadata.usage` / `metadata.cost` are the pre-migration duplicates of the
 * (denied) top-level `usage` field — kept on the type only so legacy rows
 * written before the dedicated `usage` column still type-check.
 * `queryWithWhere` itself falls back to `metadata.usage` for those rows, so
 * leaving `metadata` unsanitized would let the exact spend snapshot back in
 * through a legacy row's `metadata` blob. Every other `metadata` field is this
 * message's own presentational state and passes through untouched.
 */
const sanitizeVisitorMetadata = (
  metadata: MessageMetadata | null | undefined,
): MessageMetadata | null | undefined => {
  if (!metadata) return metadata;
  const { usage: _usage, cost: _cost, ...rest } = metadata;
  return rest;
};

/**
 * Project Work summaries for a share visitor. A visitor run executes as the
 * creator, so `userId` / `workspaceId` on every Work are the CREATOR's account
 * and workspace — dropped unconditionally, like the message-level `sender`.
 * The version spend snapshot is the creator's billing figure and follows the
 * `showModelInfo` gate (`stripSpend`).
 *
 * The identity keys are omitted rather than nulled (`userId` is non-nullable on
 * `WorkItem`); no visitor-facing Work surface reads them.
 */
const sanitizeVisitorWorks = (
  works: WorkSummaryItem[] | undefined,
  { stripSpend }: { stripSpend: boolean },
): WorkSummaryItem[] | undefined =>
  works?.map((work) => {
    const { userId: _userId, workspaceId: _workspaceId, ...rest } = work;
    const visible = stripSpend
      ? {
          ...rest,
          event: { ...rest.event, cumulativeCost: null, cumulativeUsage: null },
          totalCost: null,
        }
      : rest;
    return visible as WorkSummaryItem;
  });

/**
 * Strip creator-only fields from a message row before it reaches an
 * agent-share visitor. Creator account identity never crosses the share
 * boundary; the creator's model/provider/spend choices cross it only when the
 * share sets `showModelInfo`, and raw error payloads only when it sets
 * `showErrorDetails` ({@link VisitorRedactionOptions}).
 *
 * Built from {@link VISITOR_MESSAGE_ALLOWED_KEYS} plus explicit handling for
 * the fields that need transformation rather than a plain allow/deny.
 */
export const toVisitorMessage = (
  message: UIChatMessage,
  options: VisitorRedactionOptions = {},
): UIChatMessage => {
  const stripModelInfo = !options.showModelInfo;

  return {
    ...pickAllowedKeys(message),
    // `sender` is the CREATOR's account identity — never gated by any config
    // flag, since no share setting is about exposing whose account runs the
    // agent.
    sender: null,
    extra: stripModelInfo ? sanitizeVisitorExtra(message.extra) : message.extra,
    metadata: stripModelInfo ? sanitizeVisitorMetadata(message.metadata) : message.metadata,
    // Unbounded per-tool blobs: a tool runtime controls everything inside
    // them, so a fixed field allowlist can't classify their contents — the
    // creator-identity key set is recursed out instead.
    pluginError: stripModelInfo
      ? redactCreatorPrivateBlob(message.pluginError)
      : message.pluginError,
    pluginState: stripModelInfo
      ? redactCreatorPrivateBlob(message.pluginState)
      : message.pluginState,
    // Projected, not redacted — see `sanitizeVisitorError`.
    error: sanitizeVisitorError(message.error, options),
    ...(stripModelInfo
      ? {
          model: undefined,
          provider: undefined,
          signalCallbacks: sanitizeVisitorSignalCallbacks(message.signalCallbacks),
          taskCompletions: sanitizeVisitorTaskCompletions(message.taskCompletions),
          taskDetail: sanitizeVisitorTaskDetail(message.taskDetail),
          usage: undefined,
        }
      : {
          model: message.model,
          provider: message.provider,
          signalCallbacks: message.signalCallbacks,
          taskCompletions: message.taskCompletions,
          taskDetail: message.taskDetail,
          usage: message.usage,
        }),
    // Work summaries reach a visitor only when the query ran under their share
    // scope (see `queryForVisitor`), so every item here was registered from
    // this visitor's own topic. Creator identity is always dropped; spend
    // follows the `showModelInfo` gate — see `sanitizeVisitorWorks`.
    works: sanitizeVisitorWorks(message.works, { stripSpend: stripModelInfo }),
    // A compacted topic nests raw rows under the group node, and group chat
    // nests member messages, so anything less than a full recursive sanitize
    // would leave the creator's identity on everything inside it.
    ...(message.compressedMessages && {
      compressedMessages: message.compressedMessages.map((nested) =>
        toVisitorMessage(nested, options),
      ),
    }),
    ...(message.members && {
      members: message.members.map((nested) => toVisitorMessage(nested, options)),
    }),
    // `pinnedMessages` is only ever the narrow group-node projection (see
    // `queryMessageGroupNodes` in the Compression branch). Emit it in both
    // modes — sanitized when the model snapshot is not shared, otherwise
    // untouched.
    ...(message.pinnedMessages && {
      pinnedMessages: stripModelInfo
        ? (sanitizeVisitorGroupSnapshots(
            message.pinnedMessages as unknown as VisitorGroupSnapshotProjection[],
          ) as unknown as UIChatMessage['pinnedMessages'])
        : message.pinnedMessages,
    }),
    // `children` is polymorphic: a `compareGroup` node carries the same bare
    // {id, role, model, provider, content, createdAt} snapshot as
    // `pinnedMessages`; an `assistantGroup` node (produced inside
    // `compressedMessages` by `FlatListBuilder`) carries full
    // `AssistantContentBlock[]` with `usage`, `tools`, `error`, `metadata`,
    // `performance`, and possibly nested `council` messages with `sender` —
    // so a compareGroup-only narrow sanitize would let all of those through
    // for an assistantGroup child. Route by the PARENT `role` and recurse
    // assistantGroup children through `toVisitorMessage` itself so the
    // allowlist / error projection / usage & metadata stripping / council
    // recursion all apply.
    ...(message.children && {
      children:
        message.role === 'compareGroup'
          ? stripModelInfo
            ? (sanitizeVisitorGroupSnapshots(
                message.children as unknown as VisitorGroupSnapshotProjection[],
              ) as unknown as UIChatMessage['children'])
            : message.children
          : ((message.children as unknown as UIChatMessage[]).map((child) =>
              toVisitorMessage(child, options),
            ) as unknown as UIChatMessage['children']),
    }),
    // `AssistantContentBlock.council` on a nested assistantGroup child is a
    // `Message[]` of the supervisor's broadcast members, each carrying its
    // own `sender` / model / usage. `pickAllowedKeys` drops `council`
    // outright (fail closed), so re-attach a recursively sanitized copy
    // whenever the source carried one.
    ...((message as unknown as { council?: unknown }).council !== undefined &&
      ({
        council: ((message as unknown as { council?: UIChatMessage[] }).council ?? []).map(
          (member) => toVisitorMessage(member, options),
        ),
      } as unknown as Partial<UIChatMessage>)),
  } as UIChatMessage;
};
