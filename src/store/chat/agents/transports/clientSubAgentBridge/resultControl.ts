import { debug } from 'debug';

import { aiAgentService } from '@/services/aiAgent';

import { type ClientSubAgentBridgeRegistration } from './types';

const log = debug('lobe-store:client-subagent-bridge');

const WITHHELD_CONTENT = 'Tool result withheld by afterToolCall hook.';

/**
 * P1 (round-23): run the parent's `afterToolCall` result-control BEFORE any
 * content is published. The runtime's deferred branch returns before the
 * normal hook pipeline runs, so a direct backfill bypasses a hook configured
 * to deny the child's result — the raw content would reach the tool card and
 * the parent model. The server runs the same `controlDeferredToolResult`
 * pipeline its own completion bridges use and returns the (possibly replaced)
 * result.
 *
 * Fail-closed: an evaluation error RETHROWS — the fire's outer catch restores
 * the claim + barrier slot and arms the retry driver, so the review re-runs
 * on the next attempt and no content is published from an unreviewed result.
 * A deny replaces the ENTIRE model-facing result: the hook's denial reason
 * becomes the content, the child's raw output is discarded (billing facts
 * stay in the state the server returned), and the flow continues with
 * `success: false` (a deny decides the content, not the resume).
 */
export const reviewChildResultBeforePublish = async (
  registration: ClientSubAgentBridgeRegistration,
  childThreadId: string | null | undefined,
  resultContent: string,
  succeeded: boolean,
  stats: Record<string, number | string | undefined>,
): Promise<{
  content: string;
  stats: Record<string, number | string | undefined>;
  succeeded: boolean;
}> => {
  const parentOperationId =
    registration.kind === 'sub-agent'
      ? registration.parentOperationId
      : registration.orchestrationOperationId;
  if (!parentOperationId) return { content: resultContent, stats, succeeded };

  const controlled = await aiAgentService.controlClientSubAgentToolResult({
    operationId: parentOperationId,
    result: {
      content: resultContent,
      error: succeeded ? undefined : resultContent,
      state: {
        ...stats,
        status: succeeded ? 'completed' : 'error',
        threadId: childThreadId,
      },
      success: succeeded,
    },
    toolMessageId: registration.toolMessageId,
  });
  if (controlled.blocked) {
    log('bridge: result-control denied the child result for %s', childThreadId);
    return {
      content: controlled.content || WITHHELD_CONTENT,
      stats: (controlled.state as Record<string, string | number | undefined> | undefined) ?? stats,
      succeeded: false,
    };
  }
  if (controlled.content !== undefined && controlled.content !== resultContent) {
    return {
      content: controlled.content,
      stats: (controlled.state as Record<string, string | number | undefined> | undefined) ?? stats,
      succeeded,
    };
  }
  return { content: resultContent, stats, succeeded };
};
