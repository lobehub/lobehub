import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { LobeAgentAgencyConfig, RequestTrigger } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { resolveExecutionPlan } from '@/helpers/executionTarget';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import type { AgentShareGate } from '../shareGate';

/**
 * Heterogeneous runtimes a share visitor may run, on a device the share grants
 * them. Both run as a local CLI on that device; platform agents (OpenClaw /
 * Hermes) and the other CLIs have no visitor-scoped dispatch.
 */
const SHARE_VISITOR_HETERO_TYPES = new Set<string>(['claude-code', 'codex']);

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
 * spent). A visitor may run Claude Code / Codex only when the share grants
 * them the Agent's device (`shareGate.canUseDevice`), and only there: the CLI
 * then has a shell on the creator's machine, which is exactly what that grant
 * hands over. Every other heterogeneous runtime, and every visitor without the
 * grant, is refused.
 *
 * The run goes to the Agent's device or nowhere — never the cloud sandbox,
 * which would hold creator credentials in a box the visitor's prompt
 * controls. An offline or unset device is a clear refusal the visitor can
 * retry, instead of a failed turn counted against the topic.
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
}: AssertShareHeteroAllowedParams) => {
  if (!shareGate) return;
  const type = heterogeneousType ?? (isHeterogeneousAgentModelId(model) ? model : undefined);
  if (!type) return;
  if (!shareGate.canUseDevice || !SHARE_VISITOR_HETERO_TYPES.has(type))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
    });

  // Online devices are passed in so an `auto` Agent with one online device
  // resolves to it, exactly as the dispatch will.
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
};
