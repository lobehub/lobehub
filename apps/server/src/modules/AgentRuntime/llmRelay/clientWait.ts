import type { AgentRunClientLlmWait, AgentRuntimeContext } from '@lobechat/agent-runtime';
import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ClientLlmUnavailableReason } from './errors';

/**
 * `waiting_for_client` (U4c, T-540 D3 = a): a run whose next LLM call can only
 * run on the user's device, with no client there to take it — a schedule, a
 * bot, a CLI run, every tab closed. Instead of failing, the run parks on that
 * step, keeps what it already produced, and tells the user why. A client that
 * can run the provider continues it from the same step; past the wait window
 * it ends with an actionable error.
 */

/**
 * How long a parked run waits for a client. Well inside the gateway's 30 min
 * inactivity watchdog, so the parked stream is never reaped as dead first.
 * `AGENT_LLM_RELAY_CLIENT_WAIT_MS` overrides it (self-hosting, tests).
 */
export const DEFAULT_LLM_RELAY_CLIENT_WAIT_MS = 10 * 60_000;

const MAX_LLM_RELAY_CLIENT_WAIT_MS = 25 * 60_000;

export const resolveClientLlmWaitMs = (env: Record<string, string | undefined> = process.env) => {
  const configured = Number(env.AGENT_LLM_RELAY_CLIENT_WAIT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_LLM_RELAY_CLIENT_WAIT_MS;
  return Math.min(configured, MAX_LLM_RELAY_CLIENT_WAIT_MS);
};

export const buildClientLlmWait = (params: {
  assistantMessage?: { id: string; parentId?: string | null } | null;
  context?: AgentRuntimeContext;
  now?: number;
  provider: string;
  reason: ClientLlmUnavailableReason;
  waitMs?: number;
}): AgentRunClientLlmWait => {
  const now = params.now ?? Date.now();
  const context = params.context;
  return {
    assistantMessageId: params.assistantMessage?.id,
    ...(context && {
      context: {
        initialContext: context.initialContext,
        metadata: context.metadata,
        payload: context.payload,
        phase: context.phase,
      },
    }),
    expiresAt: new Date(now + (params.waitMs ?? resolveClientLlmWaitMs())).toISOString(),
    parentMessageId: params.assistantMessage?.parentId ?? undefined,
    parkedAt: new Date(now).toISOString(),
    provider: params.provider,
    reason: params.reason,
  };
};

/**
 * What the parked call's assistant row shows while the run waits: the same
 * error type as a failed relay, flagged `waitingForClient` so the UI renders
 * the waiting card (and its "continue here") instead of a final error.
 */
export const buildClientLlmWaitMessageError = (wait: AgentRunClientLlmWait): ChatMessageError => ({
  body: {
    expiresAt: wait.expiresAt,
    provider: wait.provider,
    reason: wait.reason,
    recoverable: true,
    waitingForClient: true,
  },
  message: `Waiting for a LobeHub client that can reach ${wait.provider}`,
  type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
});

/**
 * Step context that replays the parked call: the parked step's own context, so
 * the agent rebuilds the same LLM request. The resumed state also seeds
 * `pendingAssistantMessageId`, so the call fills the assistant row it already
 * created; `user_input` carries that id in its payload instead.
 */
export const buildClientLlmWaitResumeContext = (
  wait: AgentRunClientLlmWait | undefined,
): AgentRuntimeContext => {
  const context = wait?.context;
  if (context && context.phase !== 'user_input') return { ...context };

  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  return {
    ...context,
    payload: {
      ...payload,
      ...(wait?.assistantMessageId && { assistantMessageId: wait.assistantMessageId }),
      ...(wait?.parentMessageId && { parentMessageId: wait.parentMessageId }),
    },
    phase: 'user_input',
  } as AgentRuntimeContext;
};
