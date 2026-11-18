import type { LobeChatDatabase } from '@lobechat/database';

import { AgentOperationModel } from '@/database/models/agentOperation';
import type { ChannelOpeningCandidate } from '@/database/repositories/channel';
import { classifyRunFailure } from '@/server/services/goal/recoveryPolicy';

/** The longest usage window a CLI reports (weekly), with a day to spare. */
const LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * When the Agent's usage window reopens, if its requester's last finished run of it was refused
 * by a window that is still closed; undefined otherwise.
 *
 * The run happens as the requester (their device and its CLI login), so their own runs are the
 * ones that say whether this one will be refused too. A run that finished after the refusal, an
 * expired window, or a failure without a reset time say nothing.
 */
export const knownQuotaReset = async (
  db: LobeChatDatabase,
  candidate: Pick<ChannelOpeningCandidate, 'agent' | 'requesterUserId' | 'workspaceId'>,
  now = Date.now(),
): Promise<number | undefined> => {
  const latest = await new AgentOperationModel(
    db,
    candidate.requesterUserId,
    candidate.workspaceId ?? undefined,
  ).findLatestSettledByAgent(candidate.agent.id, new Date(now - LOOKBACK_MS));
  if (latest?.status !== 'error') return;

  const failure = classifyRunFailure(latest.error);
  if (failure.kind !== 'quota_reset' || !failure.resetsAt || failure.resetsAt <= now) return;
  return failure.resetsAt;
};
