import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import type { AbandonedSubAgentResume } from '@/server/services/agentRuntime';
import { deliverWebhook } from '@/server/services/agentRuntime/hooks/HookDispatcher';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:resume-abandoned-parent');

/**
 * Resume the parent of an abandoned sub-agent. Whoever abandoned the child
 * killed it without firing its onComplete bridge, so the parent stays parked in
 * `waiting_for_async_tool` until this runs. Every caller that receives
 * `subAgentResume` from `finalizeAbandoned` must hand it here.
 *
 * Callers may fire exactly once and never retry, so the resume carries its own
 * durability. A transient DB/Redis failure mid-bridge (the backfill in
 * particular) cannot be recovered by the parent's async-tool verify watchdog —
 * that only re-reads the barrier, it can't recreate the missing tool-message
 * backfill. So in queue mode we hand off to the same QStash-backed
 * `/subagent-callback` the normal completion path uses: QStash redelivers on
 * non-2xx until the backfill + CAS-resume land (the callback re-resolves userId
 * from the coordinator metadata, which `finalizeAbandoned` deliberately keeps
 * alive for sub-agent ops). In local/dev (no queue) we run the bridge inline.
 *
 * Failures propagate so the caller can surface them instead of reporting the
 * parent as handled while it stays parked forever.
 */
export async function resumeAbandonedParent(
  serverDB: LobeChatDatabase,
  operationId: string,
  resume: AbandonedSubAgentResume,
): Promise<void> {
  const {
    errorMessage,
    parentOperationId,
    streamOwnerUserId,
    threadId,
    toolMessageId,
    userId,
    workspaceId,
  } = resume;
  // Child reached a terminal failure → the bridge backfills the parent's tool
  // slot with an error note rather than a stub answer.
  const bridgeBody = {
    errorMessage,
    operationId,
    parentOperationId,
    reason: 'error',
    threadId,
    toolMessageId,
  };

  if (process.env.QSTASH_TOKEN) {
    await deliverWebhook(
      { delivery: 'qstash', fallback: 'none', url: '/api/agent/webhooks/subagent-callback' },
      bridgeBody,
    );
    log('[%s] queued durable parent-resume for %s', operationId, parentOperationId);
    return;
  }

  // No durable queue configured: run the CAS-guarded, idempotent bridge inline
  // through AiAgentService so the runtime's models stay workspace-scoped.
  // Mirror the queue-mode `subagent-callback`: opt into visitor rows only when
  // the parent op is a shared-agent visitor run (surfaced via
  // `streamOwnerUserId`). Ordinary creator runs keep the default exclusion.
  const aiAgentService = new AiAgentService(serverDB, userId, {
    includeShareVisitor: Boolean(streamOwnerUserId),
    workspaceId,
  });
  const won = await aiAgentService.completeSubAgentBridge(bridgeBody);
  log('[%s] resumed parent %s inline (local mode, won=%s)', operationId, parentOperationId, won);
}
