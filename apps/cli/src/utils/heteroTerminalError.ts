import {
  classifyHeteroProcessFailure,
  isHeteroStatusGuideErrorData,
} from '@lobechat/heterogeneous-agents/spawn';

/**
 * Status-guide payload (`agentType` + `code`) for a terminal `error` event.
 *
 * Adapters that classify their own failures (overloaded / rate limit / auth)
 * keep their payload. A bare one — an ACP agent reporting a failed
 * `session/new` sign-in check — gets the classification the finish leg would
 * apply to the same text, so the error persisted from the stream opens the
 * install / sign-in guide instead of the generic error card.
 *
 * Returns `undefined` when the failure is not one the guide can act on.
 */
export const resolveTerminalErrorGuide = (
  data: Record<string, unknown> | undefined,
  agent: { agentType: string; command?: string },
): Record<string, unknown> | undefined => {
  if (isHeteroStatusGuideErrorData(data)) return data;
  const detail = String(data?.message ?? data?.error ?? '');
  const classified = classifyHeteroProcessFailure({ ...agent, detail });
  return classified && { ...data, ...classified };
};
