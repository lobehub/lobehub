import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

import type { BotReplyLocale } from './platforms';
import { renderAgentError } from './replyTemplate';

/**
 * Render a thrown value as a user-facing IM failure reply.
 *
 * The bot's failure paths that catch a raw `Error` (bridge startup, the
 * handleMention / router catch-alls) used to render `renderError(operationId)`,
 * which produces a bare "**Agent Execution Failed**" — and, when the operation
 * never got far enough to have an id, not even that (LOBE-13787: the user saw
 * two consecutive failures carrying no information at all).
 *
 * Running the value through the runtime's own error normalizer first gives
 * those paths the same `errorType` + `attribution` the completion path already
 * receives from the lifecycle event, so `renderAgentError` can pick curated
 * copy ("Something went wrong on our side…", "Model provider temporarily
 * unavailable…") instead of the opaque legacy template.
 *
 * The raw message is passed only as a matching signal — `renderAgentError`
 * never emits it (see the legacy-tier comment there).
 */
export const renderThrownAgentError = (
  error: unknown,
  operationId: string | undefined,
  replyLocale?: BotReplyLocale,
): string => {
  const formatted = formatErrorForState(error);

  // An unclassified throw normalizes to a numeric `InternalServerError`, which
  // carries no spec and therefore no attribution — that is exactly the case
  // that used to render the bare header. These call sites only ever catch a
  // throw out of our OWN harness (bridge startup, router catch-all), never a
  // provider response, so `harness` is the honest default: "something went
  // wrong on our side, it is logged, retry or quote the operation id".
  return renderAgentError(
    formatted.type === undefined ? undefined : String(formatted.type),
    formatted.message,
    operationId,
    replyLocale,
    formatted.attribution ?? 'harness',
  );
};
