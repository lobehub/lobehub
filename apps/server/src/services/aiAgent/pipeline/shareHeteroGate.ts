import { isAgentShareVisitorHeteroType, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { LobeAgentAgencyConfig, RequestTrigger } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { resolveExecutionPlan } from '@/helpers/executionTarget';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import type { AgentShareGate } from '../shareGate';

export interface AssertShareHeteroAllowedParams {
  agencyConfig?: LobeAgentAgencyConfig;
  db: LobeChatDatabase;
  heterogeneousType?: string;
  model: string;
  /** The creator, whose devices the run uses. */
  ownerUserId: string;
  requestedDeviceId?: string;
  shareGate?: AgentShareGate;
  trigger?: string;
  workspaceId?: string;
}

/**
 * Share-visitor fail-closed gate for heterogeneous agents, checked BEFORE any
 * topic/message row is written (and so before the visitor's topic quota is
 * spent). A visitor may run a locally executed runtime (Claude Code, Codex and
 * the other local CLIs) only when the share grants
 * them the Agent's device (`shareGate.canUseDevice`), and only there: the CLI
 * then has a shell on the creator's machine, which is exactly what that grant
 * hands over. Remote platform runtimes (OpenClaw / Hermes), and every visitor without the
 * grant, is refused.
 *
 * The run goes to the Agent's device or nowhere — never the cloud sandbox,
 * which would hold creator credentials in a box the visitor's prompt
 * controls. An offline or unset device is a clear refusal the visitor can
 * retry, instead of a failed turn counted against the topic.
 *
 * Returns the device the share run goes to, so the dispatch routes there too:
 * an `auto` Agent's single online device is found only here, because the
 * dispatch does not look at online devices.
 */
export const assertShareHeteroAllowed = async ({
  agencyConfig,
  db,
  heterogeneousType,
  model,
  ownerUserId,
  requestedDeviceId,
  shareGate,
  trigger,
  workspaceId,
}: AssertShareHeteroAllowedParams): Promise<string | undefined> => {
  if (!shareGate) return;
  const type = heterogeneousType ?? (isHeterogeneousAgentModelId(model) ? model : undefined);
  if (!type) return;
  if (!shareGate.canUseDevice || !isAgentShareVisitorHeteroType(type))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
    });

  // Online devices are passed in so an `auto` Agent with one online device
  // resolves to it.
  const onlineDeviceIds = (await getScopedOnlineDevices(db, ownerUserId, workspaceId))
    .filter((device) => device.online)
    .map((device) => device.deviceId);
  const plan = resolveExecutionPlan({
    agencyConfig,
    canUseDevice: true,
    clientExecutionAvailable: false,
    isHetero: true,
    onlineDeviceIds,
    requestedDeviceId,
    sandboxExecutionAvailable: false,
    trigger: trigger as RequestTrigger | undefined,
  });
  if (plan.kind !== 'device')
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: ChatErrorType.ShareHeteroDeviceUnavailable,
    });

  return plan.deviceId;
};
