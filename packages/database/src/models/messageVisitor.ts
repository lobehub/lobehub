import type {
  AssistantContentBlock,
  ChatMessageError,
  ChatMessageExtra,
  MessageMetadata,
  TaskDetail,
  UIChatMessage,
  UISignalCallbacksBlock,
} from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

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
 * denylist fails OPEN on every such addition — a new field reaches visitors
 * by default until someone remembers to also strip it here, which is
 * exactly how `model`/`provider` (`message.ts`'s own top-level columns) leaked
 * despite this function's other redactions and its regression test. An
 * allowlist fails CLOSED: a new field is absent from the visitor DTO until a
 * human deliberately adds it below. `VISITOR_MESSAGE_KEYS_GUARD.test.ts`
 * (co-located with this model's tests) parses the `UIChatMessage` interface
 * source and fails the build if it grows a key that isn't classified as
 * either allowed here or explicitly denied/specially-handled below — so the
 * "silently reaches visitors" failure mode is closed at the type level, not
 * just documented in this comment.
 *
 * Deliberately included despite being an id: `agentId` (the visitor already
 * knows which agent they are talking to — that's the whole premise of the
 * share link), `sessionId`/`traceId`/`observationId` (opaque ids scoped to
 * THIS execution of the visitor's OWN turn, reused by client actions such as
 * translate/regenerate that the share UI shares with normal chat — not a
 * cross-conversation or account-identifying value).
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
] as const satisfies readonly (keyof UIChatMessage)[];

/**
 * Fields that must NEVER reach a visitor, listed explicitly (rather than left
 * as "everything not allowed") so the classification guard test below has a
 * concrete set to check every `UIChatMessage` key against, and so a reviewer
 * reading this file sees WHY each one is excluded instead of having to infer
 * it from absence.
 *
 * - `sender` / `usage`: the creator's account identity and spend/token
 *   snapshot for this message.
 * - `model` / `provider`: the creator's exact model/provider choice — the
 *   original leak the query-for-visitor regression test claimed (incorrectly) to
 *   cover. Omitted here rather than nulled: `pickAllowedKeys` never copies
 *   them, so they are simply absent from the visitor object.
 * - `works`: joins live task/version state under the CREATOR's account.
 *   `queryForVisitor`'s only caller already passes `skipWorks: true` (see
 *   `shareChat.ts`), but this list makes that a structural guarantee instead
 *   of relying on every future caller remembering the flag.
 */
const VISITOR_MESSAGE_DENIED_KEYS = ['sender', 'usage', 'model', 'provider', 'works'] as const;

/**
 * Fields that reach a visitor but need transformation rather than a plain
 * allow/deny: nested full messages (recursively sanitized by
 * {@link toVisitorMessage} itself), narrow model-snapshot projections
 * (`pinnedMessages`, `children`, `signalCallbacks`), payloads carrying
 * creator cost data that isn't the top-level `usage` field (`taskDetail`,
 * `taskCompletions`), and unbounded per-tool blobs whose contents are
 * entirely up to the tool's own server runtime (`pluginState`,
 * `pluginError`).
 *
 * `pluginState`/`pluginError` were previously plain entries in
 * {@link VISITOR_MESSAGE_ALLOWED_KEYS}, which only proves the FIELD is safe
 * to forward, not its CONTENTS — `pluginState?: any` on `UIChatMessage`
 * means a builtin tool's server runtime controls everything inside it. Codex
 * P2: `lobe-agent`'s `analyzeMedia` API writes
 * `model`/`provider`/`usage` straight into its `pluginState`
 * (`apps/server/src/services/toolExecution/serverRuntimes/lobeAgent.ts`'s
 * `analyzeMedia`, `state: { model, provider, usage, ... }`) — the exact
 * runtime identifiers and creator-billed token snapshot this file's
 * top-level `usage`/`model`/`provider` denial exists to keep from visitors,
 * reintroduced through a field the allowlist admitted wholesale.
 * {@link redactCreatorPrivateBlob} closes this recursively rather than
 * per-tool: `pluginState`'s shape is not enumerable the way `UIChatMessage`'s
 * own keys are (a new tool, or a new
 * field on an existing tool's `state`, ships with no signal that it needs
 * classifying here), so a fixed set of creator-identity/spend key names is
 * stripped at ANY nesting depth instead of allowlisting every tool's output
 * shape by hand.
 *
 * `signalCallbacks`/`taskCompletions` are virtual, denormalized-at-query-time
 * blocks built by `FlatListBuilder` (`packages/conversation-flow`) for
 * `assistantGroup`/`supervisor` messages — `signalCallbacks[].callbacks[]`
 * carries a bare `model`/`provider` snapshot per callback turn, and
 * `taskCompletions[]` carries a per-block `usage` snapshot, the same class of
 * leak as the `pinnedMessages`/`children` projections but never covered by
 * that fix.
 *
 * `error` was previously a plain entry in {@link VISITOR_MESSAGE_ALLOWED_KEYS}
 * — the same "field is safe, contents are not" mistake as `pluginState`.
 * `formatErrorForState`
 * (`apps/server/src/modules/AgentRuntime/formatErrorForState.ts`)
 * deliberately copies `provider`, `budget`, and the raw upstream response body
 * onto `ChatMessageError.body` for every provider/quota/startup failure, so a
 * visitor who simply triggers an error (an invalid share-agent config, a
 * quota exhaustion, an upstream 500) got the creator's exact provider name,
 * remaining budget, and raw upstream diagnostics back verbatim — through
 * BOTH `queryForVisitor` (reloaded history) and the sanitized Gateway
 * snapshot (`GatewayStreamNotifier`'s `sanitizeUiMessagesForVisitor`, which
 * calls this same function). Unlike `pluginState`, `body`'s shape is
 * intentionally free-form per error source (model-runtime payload, pg driver
 * error, heterogeneous CLI wire event, raw `Error` stack) with no stable set
 * of key names to recurse-and-strip the way {@link redactCreatorPrivateBlob}
 * does — so `sanitizeVisitorError` PROJECTS instead of redacts: only `type`
 * (and, for a small allowlist of already-generic codes, `message`) survive;
 * `body` and every other classification field are dropped. See
 * {@link VISITOR_SAFE_ERROR_TYPES} for why projection beats recursive
 * redaction here, and `GatewayStreamNotifier`'s `sanitizeErrorEventDataForVisitor`
 * for the sibling fix on the LIVE `type: 'error'` stream-event path, which
 * never goes through `toVisitorMessage` at all.
 */
const VISITOR_MESSAGE_SPECIAL_KEYS = [
  'extra',
  'compressedMessages',
  'members',
  'pinnedMessages',
  'children',
  'taskDetail',
  'taskCompletions',
  'signalCallbacks',
  'metadata',
  'pluginState',
  'pluginError',
  'error',
] as const;

export const VISITOR_MESSAGE_CLASSIFIED_KEYS: readonly string[] = [
  ...VISITOR_MESSAGE_ALLOWED_KEYS,
  ...VISITOR_MESSAGE_DENIED_KEYS,
  ...VISITOR_MESSAGE_SPECIAL_KEYS,
];

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
 * Shape shared by `pinnedMessages` entries and `compareGroup.children`
 * entries (`queryMessageGroupNodes` builds `children` with this exact
 * narrow projection, then casts the whole node `as unknown as
 * UIChatMessage` — see that function — so `UIChatMessage['children']`'s
 * declared `AssistantContentBlock[]` type does not describe it at runtime).
 * Neither carries `sender`/`usage`, only the model snapshot needs stripping.
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
 * (`pluginState`/`pluginError`). A builtin tool's server runtime writes
 * whatever shape it wants into `state`/error payloads — see
 * `serverRuntimes/lobeAgent.ts`'s `analyzeMedia` (`state: { model, provider,
 * usage, ... }`) — so unlike `VISITOR_MESSAGE_DENIED_KEYS` (a short, fully
 * enumerable list of top-level `UIChatMessage` fields), there is no finite
 * set of "every tool's state shape" to allowlist by hand: a new tool, or a
 * new field on an existing tool's `state`, must be safe BY DEFAULT, not
 * after someone remembers to re-audit it. Recursing this fixed key set is
 * the fail-closed trade-off: it strips a field with one of these names
 * wherever it appears, at the cost of also stripping it in the rare case a
 * tool legitimately means something else by e.g. `model` (no such case
 * exists in the current registry — see `redactCreatorPrivateBlob`'s call
 * sites for the full per-tool audit).
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
  // (`subagent_progress` phase) reads these off `state.usage.llm.tokens`
  // under the `total*` spelling rather than `inputTokens`/`outputTokens` —
  // same class of creator token-spend data, different key name.
  'totalInputTokens',
  'totalOutputTokens',
]);

/**
 * Recursively strip {@link CREATOR_PRIVATE_BLOB_KEYS} from an unbounded
 * JSON-like value at ANY nesting depth — the structural fix for the
 * `pluginState`/`pluginError` class of leak (see
 * {@link VISITOR_MESSAGE_SPECIAL_KEYS}'s JSDoc). Only descends into plain
 * objects/arrays (`isPlainRecord` already excludes `Date`/`Error`/class
 * instances, matching this file's other blob handling) — anything else
 * (string, number, boolean, `Date`, etc.) is returned as-is, since it cannot
 * itself carry a nested creator-identity field.
 *
 * Exported so `GatewayStreamNotifier`'s live Gateway-push chokepoint
 * (`sanitizeGatewayEventData`) can apply the SAME key set to `stream_start`
 * (`model`/`provider`), `tool_end` (`result`/`payload`, which can carry a
 * tool's `state` with `model`/`provider`/`usage`), and `step_complete`
 * (`subagent_progress`'s sibling `model`/`totalCost`/token fields) — the live
 * WS payload equivalents of the persisted `pluginState`/`pluginError` blobs
 * this function was written for.
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

/** See {@link CREATOR_PRIVATE_BLOB_KEYS} / {@link redactCreatorPrivateBlob}. */
const sanitizeVisitorPluginState = (pluginState: unknown): unknown =>
  redactCreatorPrivateBlob(pluginState);

/**
 * `pluginError` is typed `any` on `UIChatMessage` for the same reason as
 * `pluginState` (a tool runtime's own error shape) and is populated from the
 * same `messagePlugins` write path (`updateToolMessage`'s `pluginError`
 * param) — treated identically rather than assumed harmless because it is
 * "just an error."
 */
const sanitizeVisitorPluginError = (pluginError: unknown): unknown =>
  redactCreatorPrivateBlob(pluginError);

/**
 * `ChatMessageError.type` codes that are safe to forward to a visitor
 * VERBATIM, `message` included — because they are purpose-built,
 * business-level codes whose throw sites already write a clean, generic
 * `message` (never string-concatenated from a raw upstream payload) and whose
 * NAME itself says nothing about the creator's provider/model/account:
 * "this shared agent hit its per-topic turn cap", not "OpenAI rejected key
 * sk-…". Every other code — including the LEGITIMATE quota/rate-limit codes
 * (`InsufficientQuota`, `RateLimitExceeded`, …), whose `message`/`body` are
 * still built by `formatErrorForState` from the raw upstream error — is
 * projected to {@link VISITOR_PUBLIC_ERROR_TYPE} by {@link sanitizeVisitorError}
 * instead. Kept as a narrow allowlist (fail closed) rather than an exclude
 * list of "known provider-identifying codes": some codes leak the provider
 * through the TYPE NAME alone (`OllamaServiceUnavailable`,
 * `InvalidBedrockCredentials`, the deprecated `NoOpenAIAPIKey`, the
 * `ComfyUI*`/`InvalidGithub*` family, …), so a denylist would need to
 * enumerate those instead — and miss the next one a model-runtime change
 * adds, the exact "silently reaches visitors" failure mode this file's
 * allowlist-shaped guard exists to close everywhere else.
 */
const VISITOR_SAFE_ERROR_TYPES = new Set<string>([
  ChatErrorType.ShareTurnLimitExceeded,
  ChatErrorType.ShareTopicLimitExceeded,
  ChatErrorType.ShareHeterogeneousAgentUnsupported,
  ChatErrorType.AgentShareProviderNotSupported,
]);

/**
 * Public fallback `type` for any `ChatMessageError` whose code is not in
 * {@link VISITOR_SAFE_ERROR_TYPES}. Reuses the existing generic
 * `AgentRuntimeError` bucket (already localized — see
 * `packages/locales/src/default/modelRuntime.ts`) rather than minting a new
 * code: the visitor only needs "the run failed, retry or contact the
 * creator," never which of the ~60 specific runtime codes fired.
 */
const VISITOR_PUBLIC_ERROR_TYPE = AgentRuntimeErrorType.AgentRuntimeError;

/**
 * Sanitize a `ChatMessageError` for a visitor — PROJECTION, not the recursive
 * `redactCreatorPrivateBlob` used for `pluginState`/`pluginError`. `body` has
 * no stable set of key names to strip: it is free-form per error source
 * (`formatErrorForState`'s model-runtime payload / pg-driver / heterogeneous
 * CLI wire-event / raw-`Error` branches all shape it differently) and
 * `formatErrorForState` deliberately copies `provider`, `budget`, and the raw
 * upstream diagnostic onto it for exactly the failures a visitor can trigger
 * on demand (bad key, exhausted quota, upstream 500) — so recursing a fixed
 * key set would miss the next shape a new error source introduces. Dropping
 * `body` wholesale and keeping only a classified `type` (+ `message` for the
 * codes in {@link VISITOR_SAFE_ERROR_TYPES}) fails closed instead: the client
 * already re-derives its localized copy, alert styling, and error-card variant
 * from `type` alone via `getRuntimeErrorMessage`/`getErrorCodeSpec`
 * (`src/features/Conversation/Error/index.tsx`), so nothing the share UI
 * genuinely renders is lost.
 *
 * See `GatewayStreamNotifier`'s `sanitizeErrorEventDataForVisitor` for the
 * sibling fix: the live `type: 'error'` Gateway stream event carries this same
 * `formatErrorForState` shape but never reaches `toVisitorMessage` at all, so
 * this function alone only protects reloaded history, not the in-flight run.
 */
export const sanitizeVisitorError = (
  error: ChatMessageError | null | undefined,
): ChatMessageError | null | undefined => {
  if (!error) return error;

  const type = error.type as unknown;
  if (typeof type === 'string' && VISITOR_SAFE_ERROR_TYPES.has(type)) {
    return { message: error.message, type: error.type };
  }

  return { type: VISITOR_PUBLIC_ERROR_TYPE };
};

/**
 * `signalCallbacks[].callbacks[]` is a denormalized per-callback snapshot
 * built by `FlatListBuilder` (`result.signalCallbacks = signalCallbackBlocks
 * .map(...)` in `packages/conversation-flow`), carrying a bare
 * `model`/`provider` pair per callback turn — same leak class as
 * `pinnedMessages`/`children`'s group-node snapshots, just never covered by
 * that fix since this field didn't exist yet when it shipped.
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
 * `taskCompletions[]` blocks are denormalized post-task-summary snapshots
 * built by `FlatListBuilder` (`result.taskCompletions = taskCompletionMessages
 * .map(...)` in `packages/conversation-flow`), each carrying its own
 * `usage` — the same class of creator spend data as the top-level `usage`
 * field this file already denies.
 */
const sanitizeVisitorTaskCompletions = (
  taskCompletions: AssistantContentBlock[] | undefined,
): AssistantContentBlock[] | undefined =>
  taskCompletions?.map(({ usage: _usage, ...rest }) => rest);

/**
 * `metadata.usage` / `metadata.cost` are the pre-migration duplicates of the
 * (denied) top-level `usage` field — kept on the type only so legacy rows
 * written before the dedicated `usage` column still type-check (see
 * `MessageMetadata`'s JSDoc). `queryWithWhere` itself falls back to
 * `metadata.usage` for those rows (`item.usage ?? metadata?.usage`), so
 * leaving `metadata` unsanitized would let the exact spend snapshot this
 * function denies at the top level back in through a legacy row's `metadata`
 * blob. Every other `metadata` field (collapsed state, context selections,
 * work/verify/taskCallback pointers, …) is this message's own presentational
 * state, not creator account data, and passes through untouched.
 */
const sanitizeVisitorMetadata = (
  metadata: MessageMetadata | null | undefined,
): MessageMetadata | null | undefined => {
  if (!metadata) return metadata;
  const { usage: _usage, cost: _cost, ...rest } = metadata;
  return rest;
};

/**
 * Strip creator-only fields from a message row before it reaches an
 * agent-share visitor. Visitor-facing message DTO: creator account identity
 * — and the creator's model/provider/spend choices — never cross the share
 * boundary; only role/content and the message's own presentational payload
 * (files, tool results, translation, TTS) do.
 *
 * Built from {@link VISITOR_MESSAGE_ALLOWED_KEYS} (see that constant for why
 * this is allowlist-, not denylist-, shaped) plus explicit handling for the
 * fields that need transformation rather than a plain allow/deny.
 */
export const toVisitorMessage = (message: UIChatMessage): UIChatMessage =>
  ({
    ...pickAllowedKeys(message),
    extra: sanitizeVisitorExtra(message.extra),
    metadata: sanitizeVisitorMetadata(message.metadata),
    // Unbounded per-tool blobs — see `pluginState`/`pluginError`'s entry in
    // `VISITOR_MESSAGE_SPECIAL_KEYS`'s JSDoc for why these need recursive
    // redaction rather than a plain allow.
    pluginError: sanitizeVisitorPluginError(message.pluginError),
    pluginState: sanitizeVisitorPluginState(message.pluginState),
    // Projected, not redacted — see `error`'s entry in
    // `VISITOR_MESSAGE_SPECIAL_KEYS`'s JSDoc / `sanitizeVisitorError`.
    error: sanitizeVisitorError(message.error),
    sender: null,
    signalCallbacks: sanitizeVisitorSignalCallbacks(message.signalCallbacks),
    taskCompletions: sanitizeVisitorTaskCompletions(message.taskCompletions),
    taskDetail: sanitizeVisitorTaskDetail(message.taskDetail),
    usage: undefined,
    works: undefined,
    // A compacted topic nests raw rows under the group node, and group chat
    // nests member messages, so anything less than a full recursive sanitize
    // would leave the creator's identity on everything inside it.
    ...(message.compressedMessages && {
      compressedMessages: message.compressedMessages.map((nested) => toVisitorMessage(nested)),
    }),
    ...(message.members && {
      members: message.members.map((nested) => toVisitorMessage(nested)),
    }),
    ...(message.pinnedMessages && {
      pinnedMessages: sanitizeVisitorGroupSnapshots(
        message.pinnedMessages as unknown as VisitorGroupSnapshotProjection[],
      ) as unknown as UIChatMessage['pinnedMessages'],
    }),
    // `compareGroup` nodes carry the same bare model/provider snapshot under
    // `children` (see `queryMessageGroupNodes`) — previously left untouched
    // by this function even though it is structurally identical to the
    // `pinnedMessages` leak.
    ...(message.children && {
      children: sanitizeVisitorGroupSnapshots(
        message.children as unknown as VisitorGroupSnapshotProjection[],
      ) as unknown as UIChatMessage['children'],
    }),
  }) as UIChatMessage;
