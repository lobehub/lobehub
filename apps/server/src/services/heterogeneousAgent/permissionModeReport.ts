import type { HeteroPermissionMode } from '@lobechat/types';

import type { TopicModel } from '@/database/models/topic';

type TopicMetadataWriter = Pick<TopicModel, 'findById' | 'updateMetadata'>;

/**
 * Before dispatching a Claude Code run with a mode that asks, remember that
 * its mode report is owed. A current `lh` reports it as soon as Claude Code
 * starts (and the report clears this); one that predates permission modes
 * never does and runs with every action allowed.
 */
export const expectPermissionModeReport = async (
  topicModel: TopicMetadataWriter,
  {
    mode,
    operationId,
    topicId,
  }: { mode?: HeteroPermissionMode; operationId: string; topicId: string },
): Promise<void> => {
  if (!mode || mode === 'bypassPermissions') return;
  await topicModel.updateMetadata(topicId, { heteroPermissionModeReportPending: operationId });
};

/**
 * At a run's end: a run that finished cleanly without reporting its mode ran
 * on an `lh` that ignores modes, so the topic says so (and keeps the pick). A
 * failed or stopped run may never have started Claude Code, so it says nothing.
 */
export const settlePermissionModeReport = async (
  topicModel: TopicMetadataWriter,
  { operationId, succeeded, topicId }: { operationId: string; succeeded: boolean; topicId: string },
): Promise<void> => {
  const topic = await topicModel.findById(topicId);
  if (topic?.metadata?.heteroPermissionModeReportPending !== operationId) return;
  await topicModel.updateMetadata(topicId, {
    heteroPermissionModeReportPending: null,
    ...(succeeded && { heteroPermissionModeFallback: 'outdatedCli' as const }),
  });
};
