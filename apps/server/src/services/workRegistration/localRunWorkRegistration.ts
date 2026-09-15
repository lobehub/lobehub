import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { WorkModel } from '@/database/models/work';

import { UNEXECUTED_INTERVENTION_STATUSES } from './constants';
import { registerShellWorks } from './shellWorkRegistration';

const log = debug('lobe-server:local-run-work-registration');

/**
 * Prefix for the synthetic root operation id minted for desktop-local hetero
 * runs. Local runs are entirely client-driven (no `agent_operations` row, no
 * `CompletionLifecycle`), yet the Works read path joins strictly on
 * `work_versions.rootOperationId = metadata.work.rootOperationId` — so the scan
 * needs SOME stable id to key both sides. Deriving it from the anchor message
 * id keeps retries idempotent without persisting extra state; the column has no
 * FK, so a non-operation id is safe.
 */
const LOCAL_RUN_OPERATION_PREFIX = 'localrun';

export interface LocalRunShellWorksResult {
  failed: number;
  registered: number;
  /** The rootOperationId works were registered under (echoed for client-side refresh). */
  rootOperationId: string | null;
}

/**
 * Completion-time shell Work scan for a DESKTOP-LOCAL heterogeneous run
 * (Claude Code / Codex with execution target `local`).
 *
 * Those runs never reach `registerWorksForOperation` — the sole caller of the
 * shell scan — because they create no server operation and never call
 * `heteroFinish`; their `gh pr create` output lands as plain persisted tool
 * messages that nothing inspects. The client executor therefore
 * reports the run's persisted tool message ids at clean completion, and this
 * service replays the SAME scan engine over those rows:
 *
 * 1. Verify the anchor assistant message belongs to the caller + topic.
 * 2. Load the tool rows ownership- and topic-scoped (`listMessagePluginsByIds`).
 * 3. Run `registerShellWorks` under a synthetic anchor-derived rootOperationId.
 * 4. Stamp `metadata.work.rootOperationId` on the anchor so the card renders.
 *
 * Cost is intentionally null: local runs have no server-side usage snapshot
 * (hetero CLI spend is not metered per tool call), and null renders as
 * "unknown", never $0.00.
 *
 * Idempotent end to end: the version write dedupes on `(workId, toolCallId)`
 * and re-stamping the same rootOperationId is a metadata deep-merge no-op.
 */
export const registerShellWorksForLocalRun = async (params: {
  anchorMessageId: string;
  messageIds: string[];
  messageModel: MessageModel;
  topicId: string;
  workModel: WorkModel;
}): Promise<LocalRunShellWorksResult> => {
  const { anchorMessageId, messageIds, messageModel, topicId, workModel } = params;

  const anchor = await messageModel.findById(anchorMessageId);
  // The anchor must be an assistant message of the claimed topic — anything
  // else (missing, foreign, wrong role) makes the whole report untrustworthy.
  if (!anchor || anchor.topicId !== topicId || anchor.role !== 'assistant') {
    log('Rejected local run scan: invalid anchor %s for topic %s', anchorMessageId, topicId);
    return { failed: 0, registered: 0, rootOperationId: null };
  }

  const rows = await messageModel.listMessagePluginsByIds({ ids: messageIds, topicId });
  const records = rows
    .filter((row) => {
      const interventionStatus = (row.intervention as { status?: string } | undefined)?.status;
      return !(interventionStatus && UNEXECUTED_INTERVENTION_STATUSES.has(interventionStatus));
    })
    .map((row) => ({
      apiName: row.apiName ?? '',
      arguments: row.arguments,
      content: row.content,
      error: row.error,
      id: row.id,
      identifier: row.identifier,
      state: row.state,
      toolCallId: row.toolCallId ?? '',
    }));
  if (records.length === 0) return { failed: 0, registered: 0, rootOperationId: null };

  // Reuse an id a prior (retried) scan already stamped so versions and anchor
  // stay on one key; otherwise derive it from the anchor message id.
  const stampedRootId = (anchor.metadata as { work?: { rootOperationId?: string } } | null)?.work
    ?.rootOperationId;
  const rootOperationId = stampedRootId ?? `${LOCAL_RUN_OPERATION_PREFIX}_${anchorMessageId}`;

  const outcome = await registerShellWorks({
    agentId: anchor.agentId,
    cumulativeCost: null,
    cumulativeUsage: null,
    operationId: rootOperationId,
    records,
    threadId: anchor.threadId,
    topicId,
    workModel,
  });

  if (outcome.registered > 0 && !stampedRootId) {
    const stamp = await messageModel.update(anchorMessageId, {
      metadata: { work: { rootOperationId } },
    });
    if (!stamp.success) {
      outcome.failed += 1;
      log('Failed to stamp local run work anchor on %s', anchorMessageId);
    }
  }

  return {
    failed: outcome.failed,
    registered: outcome.registered,
    rootOperationId: outcome.registered > 0 ? rootOperationId : null,
  };
};
