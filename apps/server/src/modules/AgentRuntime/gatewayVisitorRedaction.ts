import type { ChatMessageError, UIChatMessage } from '@lobechat/types';

import {
  redactCreatorPrivateBlob,
  sanitizeVisitorError,
  toVisitorMessage,
  type VisitorRedactionOptions,
} from '@/database/models/message';

import { stripFinalStateInEventData } from './StreamEventManager';

/**
 * Per-operation redaction policy for a shared-agent visitor run, derived from
 * the share's `AgentShareConfig` (`showModelInfo` / `showErrorDetails`) and
 * carried on `state.metadata.agentShareVisitor`.
 *
 * `null` is the explicit "not a share run — push verbatim" marker, so a
 * missing/undefined value can stay reserved for "not resolved yet".
 */
export type GatewayVisitorRedaction = VisitorRedactionOptions | null;

/**
 * The most restrictive policy: strip model/provider/usage AND project errors
 * down to a classified type. Used as the fail-closed fallback whenever the
 * share's real config is unavailable (a queue worker that never ran the op's
 * init can only read `streamOwnerUserId` back from persisted op metadata, not
 * the share config).
 */
export const FULL_STRIP_REDACTION: GatewayVisitorRedaction = {};

/**
 * Whether `publishAgentRuntimeInit` is initializing a shared-agent visitor run.
 * The op EXECUTES as the creator, but `streamOwnerUserId` (set only for
 * share-visitor runs — see `AgentRuntimeService.createOperation`) registers
 * the Gateway WS channel under the *visitor's* id, so the visitor is the one
 * receiving this push over the wire.
 */
export const isShareVisitorInit = (initialState: any): boolean =>
  typeof initialState?.streamOwnerUserId === 'string' && initialState.streamOwnerUserId.length > 0;

/**
 * Read the redaction policy off whatever the notifier was handed.
 *
 * Two shapes reach here, deliberately handled by one function so the fast path
 * never disagrees with itself:
 *  - a runtime `AgentState`, whose `metadata.agentShareVisitor` is stamped once at
 *    operation creation (`AgentRuntimeService.createOperation`) and rides the
 *    state through to the terminal event (`publishAgentRuntimeEnd`);
 *  - an `AgentOperationMetadata` record, which is what
 *    `AgentRuntimeCoordinator.createAgentOperation` passes to
 *    `publishAgentRuntimeInit` — it carries the flattened
 *    `streamOwnerUserId` + `visitorRedaction` pair instead.
 *
 * Returns `null` for a normal (non-share) run. Fails closed to
 * {@link FULL_STRIP_REDACTION} when a run is identifiable as a share run but
 * its policy is unreadable.
 */
export const resolveRedactionFromState = (state: any): GatewayVisitorRedaction => {
  const share = state?.metadata?.agentShareVisitor as
    { showErrorDetails?: boolean; showModelInfo?: boolean; visitorUserId?: string } | undefined;

  if (share?.visitorUserId) {
    return { showErrorDetails: share.showErrorDetails, showModelInfo: share.showModelInfo };
  }

  if (!isShareVisitorInit(state)) return null;

  return (state.visitorRedaction as GatewayVisitorRedaction) ?? FULL_STRIP_REDACTION;
};

/**
 * Public `agent_runtime_init` DTO pushed to the Gateway for shared-agent
 * visitor runs. The full operation metadata must never cross the WS boundary to
 * the visitor. The client doesn't render anything from this event today —
 * `runAgent.ts`'s `agent_runtime_init` case only logs it — so `status` is the
 * only field forwarded.
 */
export const buildPublicInitEventData = (initialState: any): { status?: unknown } => ({
  status: initialState?.status,
});

/**
 * Public `agent_runtime_end` DTO pushed to the Gateway for shared-agent visitor
 * runs. `finalState` is the creator's full `AgentState`, none of which the
 * client reads off this event (`gatewayEventHandler.ts` only consumes `reason`
 * and `uiMessages`, both already-sanitized UI-facing values), so drop
 * `finalState` wholesale instead of trying to allowlist inside it.
 */
export const buildPublicEndEventData = <T extends { finalState?: unknown }>(
  data: T,
): Omit<T, 'finalState'> => {
  const { finalState: _finalState, ...rest } = data;
  return rest;
};

/**
 * Sanitize a `uiMessages` snapshot for a shared-agent visitor's WS channel.
 * `uiMessages` is the canonical `UIChatMessage[]` built from the creator's DB
 * rows (a creator-scoped query — unlike `shareChat.getMessages`, which already
 * goes through `MessageModel.queryForVisitor`). Every `step_start` and the
 * terminal `agent_runtime_end` push carry this snapshot, so without this step
 * the creator's joined `sender` identity would ride down the visitor's Gateway
 * WS channel even though `finalState` is already scrubbed. Reuses
 * `toVisitorMessage` — the same projection `shareChat.getMessages` applies — so
 * the two paths cannot drift apart.
 */
const sanitizeUiMessagesForVisitor = (
  uiMessages: unknown,
  redaction: VisitorRedactionOptions,
): unknown => {
  if (!Array.isArray(uiMessages)) return uiMessages;
  return (uiMessages as UIChatMessage[]).map((message) => toVisitorMessage(message, redaction));
};

/**
 * Sanitize a live `type: 'error'` Gateway stream event for a shared-agent
 * visitor. `ServerStreamSink.publishError` builds this event's `data` from
 * `formatErrorEventData`, which — like `formatErrorForState` — copies the raw
 * upstream `body` (provider, budget, upstream diagnostic) straight onto the
 * payload. The client (`gatewayEventHandler.ts`'s `case 'error'`) immediately
 * overlays it onto the visible message, so it reaches the visitor's screen
 * live, during the run, before any DB row (and therefore `toVisitorMessage`) is
 * ever involved. Reuses {@link sanitizeVisitorError}'s classification so the
 * live and reloaded-history projections cannot drift apart, reshaped into
 * `formatErrorEventData`'s flatter `{ error, errorType, phase }` wire shape
 * instead of `ChatMessageError`'s `{ body, message, type }`.
 */
const sanitizeErrorEventDataForVisitor = (
  data: unknown,
  redaction: VisitorRedactionOptions,
): unknown => {
  if (!data || typeof data !== 'object') return data;
  const record = data as { error?: unknown; errorType?: unknown; phase?: unknown };

  const safe = sanitizeVisitorError(
    typeof record.errorType === 'string' || typeof record.errorType === 'number'
      ? ({
          message: typeof record.error === 'string' ? record.error : undefined,
          type: record.errorType,
        } as ChatMessageError)
      : undefined,
    redaction,
  );

  return {
    ...(safe?.message === undefined ? {} : { error: safe.message }),
    ...(safe?.type === undefined ? {} : { errorType: safe.type }),
    ...(record.phase === undefined ? {} : { phase: record.phase }),
  };
};

/**
 * Chokepoint applied to every event `GatewayStreamNotifier` pushes to the
 * Gateway WS channel — not just `agent_runtime_init` / `agent_runtime_end`.
 *
 * For a share-visitor run:
 * 1. `finalState` is dropped wholesale (same DTO shape as
 *    {@link buildPublicEndEventData}) — `step_complete`, published via the
 *    generic `publishStreamEvent`, has no per-event DTO builder, so this
 *    chokepoint is its only sanitization point.
 * 2. A live `type: 'error'` event is routed through
 *    {@link sanitizeErrorEventDataForVisitor} — a SEPARATE leak from
 *    `uiMessages`/`finalState`, since it carries `formatErrorEventData`'s raw
 *    `{ body, error, errorType }` shape with no `finalState`/`uiMessages` key
 *    for the other checks to even look at. Skipped when the share opted into
 *    `showErrorDetails`.
 * 3. Unless the share opted into `showModelInfo`,
 *    {@link redactCreatorPrivateBlob} runs over the WHOLE remaining payload.
 *    Every other event type for a share run — `stream_start` (`{ model,
 *    provider }`), `tool_end` (a tool's own free-form `result.state` blob, e.g.
 *    `{ model, provider, usage }`), and `step_complete`'s `subagent_progress`
 *    phase (`{ model, totalCost, totalInputTokens, … }` as SIBLINGS of `phase`)
 *    — carries creator model/provider/usage/cost shapes. Rather than enumerate
 *    and denylist each event type (which silently stops covering the next
 *    producer that lands a new field), the recursive key-set strip is applied
 *    at any nesting depth, so a future event type or tool cannot reintroduce
 *    this leak by construction. `error` is excluded from this generic pass
 *    because it needs PROJECTION rather than key-name redaction.
 * 4. `uiMessages` additionally goes through {@link toVisitorMessage}'s full
 *    field allowlist, which the private-blob key strip alone does not cover.
 *
 * For a normal run this falls back to the generic
 * {@link stripFinalStateInEventData} (messages / tool-set fields only),
 * matching the Redis xadd chokepoint.
 */
export const sanitizeGatewayEventData = (
  data: unknown,
  redaction: GatewayVisitorRedaction,
  eventType?: unknown,
): unknown => {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;

  if (!redaction) return stripFinalStateInEventData(data);

  const withoutFinalState: Record<string, unknown> =
    'finalState' in record
      ? (() => {
          const { finalState: _finalState, ...rest } = record;
          return rest;
        })()
      : record;

  if (eventType === 'error') return sanitizeErrorEventDataForVisitor(withoutFinalState, redaction);

  const redacted = redaction.showModelInfo
    ? withoutFinalState
    : redactCreatorPrivateBlob(withoutFinalState);

  if (!('uiMessages' in withoutFinalState)) return redacted;

  return {
    ...redacted,
    uiMessages: sanitizeUiMessagesForVisitor(withoutFinalState.uiMessages, redaction),
  };
};
