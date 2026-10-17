import type { ChatMessageError, UIChatMessage } from '@lobechat/types';

import {
  redactCreatorPrivateBlob,
  sanitizeVisitorError,
  toVisitorMessage,
  type VisitorRedactionOptions,
} from '@/database/models/message';

import { isShareVisitorActor, resolveRunActor, resolveRunActorFromState } from './runIdentity';
import { stripFinalStateInEventData } from './StreamEventManager';

/**
 * Per-operation redaction policy for a shared-agent visitor run, derived from
 * the share's `AgentShareConfig` (`showModelInfo` / `showErrorDetails`) and
 * carried on `state.principal.actor.shareVisitor`.
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
 * The run actor of what `publishAgentRuntimeInit` was handed: the coordinator's
 * operation metadata, whose `streamOwnerUserId` mirror is set for every
 * share-visitor run it records.
 */
const resolveInitActor = (initialState: any) =>
  resolveRunActor(initialState?.identity, {
    shareVisitorUserId:
      typeof initialState?.streamOwnerUserId === 'string' && initialState.streamOwnerUserId
        ? initialState.streamOwnerUserId
        : null,
    userId: initialState?.userId,
  });

/**
 * Whether `publishAgentRuntimeInit` is initializing a shared-agent visitor run.
 * The op EXECUTES as the creator, but the Gateway WS channel is registered
 * under the *visitor's* id (see {@link resolveInitStreamOwner}), so the visitor
 * is the one receiving this push over the wire. Decided by the actor's kind,
 * not by the visitor differing from the creator: a creator chatting through
 * their own share link is still redacted as a visitor.
 *
 * Fails closed: an identity that cannot be trusted counts as a visitor run.
 */
export const isShareVisitorInit = (initialState: any): boolean => {
  const resolved = resolveInitActor(initialState);
  if (!resolved.ok) return resolved.reason !== 'missing';
  return isShareVisitorActor(resolved.actor);
};

/**
 * Who the Gateway registers the operation's channel under — the only user whose
 * subscriber JWT it accepts: the run's actor, so a share-visitor run streams to
 * the visitor rather than the creator it executes as. `'unknown'`, which no
 * subscriber matches, when the actor cannot be resolved or trusted.
 */
export const resolveInitStreamOwner = (initialState: any): string => {
  const resolved = resolveInitActor(initialState);
  return resolved.ok ? resolved.actor.userId : 'unknown';
};

/**
 * Read the redaction policy off whatever the notifier was handed.
 *
 * Two shapes reach here, deliberately handled by one function so the fast path
 * never disagrees with itself:
 *  - a runtime `AgentState`, whose `principal.actor.shareVisitor` is stamped once at
 *    operation creation (`AgentRuntimeService.createOperation`) and rides the
 *    state through to the terminal event (`publishAgentRuntimeEnd`);
 *  - an `AgentOperationMetadata` record, which is what
 *    `AgentRuntimeCoordinator.createAgentOperation` passes to
 *    `publishAgentRuntimeInit` — it carries the run `identity`, its flattened
 *    `streamOwnerUserId` mirror and `visitorRedaction` instead.
 *
 * Returns `null` for a normal (non-share) run. Fails closed to
 * {@link FULL_STRIP_REDACTION} when a run is identifiable as a share run but
 * its policy is unreadable, or when its identity cannot be trusted.
 */
export const resolveRedactionFromState = (state: any): GatewayVisitorRedaction => {
  // A runtime `AgentState` carries the run identity on `principal`; the
  // operation metadata carries it at the top level.
  const resolved =
    state?.principal || state?.origin ? resolveRunActorFromState(state) : resolveInitActor(state);
  if (!resolved.ok) return resolved.reason === 'missing' ? null : FULL_STRIP_REDACTION;
  if (!isShareVisitorActor(resolved.actor)) return null;

  const share = state?.principal?.actor?.shareVisitor as
    { showErrorDetails?: boolean; showModelInfo?: boolean } | undefined;
  if (share) {
    return { showErrorDetails: share.showErrorDetails, showModelInfo: share.showModelInfo };
  }

  return (state.visitorRedaction as GatewayVisitorRedaction) ?? FULL_STRIP_REDACTION;
};

/**
 * The `agent_runtime_init` DTO pushed to the Gateway.
 *
 * Applied to EVERY run, not just shared-agent visitors. No consumer reads this
 * event's data: the web handler logs it and breaks, the CLI prints a fixed
 * line, and the gateway transport does not handle the type at all. What the raw
 * `initialState` would otherwise carry is the entire `AgentState` — the LLM
 * context in `messages` plus the tool-set maps that `stripStateForStream`
 * already treats as the size problem on `finalState`, and for a visitor the
 * creator's `agentConfig` / system prompt on top.
 *
 * `status` is kept because it is the one field the shape has ever needed.
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
 * Normal step_complete events omit finalState unless the run opts in. Clients reconcile
 * messages through message_patch/uiMessages and do not consume runtime state.
 * Other events in a normal run fall back to the generic
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

  if (!redaction) return stripFinalStateInEventData(data, eventType);

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
