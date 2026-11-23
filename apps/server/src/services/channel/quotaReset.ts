import type { LobeChatDatabase } from '@lobechat/database';

import type { ChannelOpeningCandidate } from '@/database/repositories/channel';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { classifyRunFailure } from '@/server/services/goal/recoveryPolicy';

/** The longest usage window a CLI reports (weekly), with a day to spare. */
const LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;

type QuotaCandidate = Pick<
  ChannelOpeningCandidate,
  'agent' | 'deviceId' | 'memberId' | 'requesterUserId' | 'workspaceId'
>;

/**
 * Whether the run may land on one of several Claude Code logins: the Agent balances a pool on
 * this device, so a refusal of one login says nothing about the next run. Resolved the way the
 * device dispatch resolves it, as the requester.
 */
const balancesLogins = async (
  db: LobeChatDatabase,
  candidate: QuotaCandidate,
  deviceId: string,
) => {
  const quota = new AgentQuotaService(
    db,
    candidate.requesterUserId,
    candidate.workspaceId ?? undefined,
  );
  const routing = await quota.planDeviceRouting(candidate.agent.id, {
    deviceId: await quota.resolveDeviceRowId(deviceId),
    provider: 'claude-code',
  });
  return (routing?.candidates.length ?? 0) > 1;
};

/**
 * When the usage window that refused the Agent's last reply on its device reopens, if it is
 * still closed; undefined otherwise.
 *
 * A usage window belongs to the CLI login that runs the reply, so the refusal only says
 * something about this run when both run on the same login. Before the claim, that is known
 * only for a device picked in the Channel: every reply of the member runs there, for whoever
 * asked. On that device the member's newest finished reply decides, unless the Agent balances
 * several logins there. Without a picked device, only the claim resolves the device (the
 * requester's own setting, a pinned topic), so nothing is assumed.
 */
export const knownQuotaReset = async (
  db: LobeChatDatabase,
  channelId: string,
  candidate: QuotaCandidate,
  now = Date.now(),
): Promise<number | undefined> => {
  const { deviceId } = candidate;
  if (!deviceId) return;

  const latest = await new ChannelExecutionRepository(db).lastSettledReplyOnDevice(channelId, {
    deviceId,
    memberId: candidate.memberId,
    since: new Date(now - LOOKBACK_MS),
  });
  if (latest?.status !== 'failed') return;

  const failure = classifyRunFailure(latest.error);
  if (failure.kind !== 'quota_reset' || !failure.resetsAt || failure.resetsAt <= now) return;
  if (await balancesLogins(db, candidate, deviceId)) return;
  return failure.resetsAt;
};
