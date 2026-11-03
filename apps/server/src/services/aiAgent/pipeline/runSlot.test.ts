// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfigWithId } from '@/server/services/agent';

import type { InternalExecAgentParams } from '../types';
import {
  bindRunSlot,
  claimRunSlot,
  releaseUnstartedRunSlot,
  resolveRunSlotPolicy,
  type RunSlotClaim,
} from './runSlot';

const slots = vi.hoisted(() => ({
  acquireAgentRunSlot: vi.fn(),
  rebindAgentRunSlot: vi.fn(),
  releaseAgentRunSlot: vi.fn(),
}));

vi.mock('@/business/server/agent-run/runConcurrency', () => slots);

const agentConfig = { id: 'agt_1', model: 'gpt-4o' } as AgentConfigWithId;
const composerSend = {
  agentId: 'agt_1',
  interactiveStart: true,
  prompt: 'hi',
} as InternalExecAgentParams;

const policyOf = (params: Partial<InternalExecAgentParams>, workspaceId?: string) =>
  resolveRunSlotPolicy({ ...composerSend, ...params } as InternalExecAgentParams, {
    agentConfig,
    workspaceId,
  });

describe('resolveRunSlotPolicy', () => {
  it('refuses a fresh composer send past the cap', () => {
    expect(policyOf({})).toBe('enforced');
  });

  it('counts but never refuses a run that continues one already started', () => {
    expect(policyOf({ resumeApproval: { decision: 'approved' } as any })).toBe('counted');
    expect(policyOf({ steer: true } as any)).toBe('counted');
    expect(policyOf({ parentMessageId: 'msg_1' })).toBe('counted');
    expect(policyOf({ interactiveStart: false })).toBe('counted');
  });

  it('exempts sub-agent, group member, Workspace and background runs', () => {
    expect(policyOf({ parentOperationId: 'op_parent' })).toBe('exempt');
    expect(policyOf({ appContext: { isSubAgent: true } as any })).toBe('exempt');
    expect(policyOf({ appContext: { orchestrationRole: 'member' } as any })).toBe('exempt');
    expect(policyOf({}, 'ws_1')).toBe('exempt');
    expect(policyOf({ trigger: 'cron' } as any)).toBe('exempt');
  });

  it('exempts external agents', () => {
    expect(
      resolveRunSlotPolicy(composerSend, {
        agentConfig: {
          ...agentConfig,
          agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        } as AgentConfigWithId,
      }),
    ).toBe('exempt');
  });
});

describe('run slot claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects the send past the cap with TOO_MANY_REQUESTS and the cap', async () => {
    slots.acquireAgentRunSlot.mockResolvedValue({ acquired: false });
    const claim: RunSlotClaim = {};

    const error = await claimRunSlot(claim, { policy: 'enforced', userId: 'u1' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('TOO_MANY_REQUESTS');
    expect((error as TRPCError).message).toBe(ChatErrorType.AgentConcurrencyLimitExceeded);
    expect(claim.holderId).toBeUndefined();
  });

  it('takes no slot for an exempt run', async () => {
    const claim: RunSlotClaim = {};
    await claimRunSlot(claim, { policy: 'exempt', userId: 'u1' });

    expect(slots.acquireAgentRunSlot).not.toHaveBeenCalled();
    await releaseUnstartedRunSlot(claim, 'u1');
    expect(slots.releaseAgentRunSlot).not.toHaveBeenCalled();
  });

  it('asks a continuation to be counted without enforcement', async () => {
    slots.acquireAgentRunSlot.mockResolvedValue({ acquired: true });
    await claimRunSlot({}, { policy: 'counted', userId: 'u1' });

    expect(slots.acquireAgentRunSlot).toHaveBeenCalledWith(
      expect.objectContaining({ enforce: false, userId: 'u1' }),
    );
  });

  it('moves the slot to the operation and frees it when the operation never starts', async () => {
    slots.acquireAgentRunSlot.mockResolvedValue({ acquired: true });
    const claim: RunSlotClaim = {};
    await claimRunSlot(claim, { policy: 'enforced', userId: 'u1' });
    const provisional = claim.holderId!;

    await bindRunSlot(claim, 'u1', 'op_1');
    expect(slots.rebindAgentRunSlot).toHaveBeenCalledWith('u1', provisional, 'op_1');

    await releaseUnstartedRunSlot(claim, 'u1');
    expect(slots.releaseAgentRunSlot).toHaveBeenCalledWith('u1', 'op_1');
  });

  it('leaves the slot to the started operation once handed off', async () => {
    slots.acquireAgentRunSlot.mockResolvedValue({ acquired: true });
    const claim: RunSlotClaim = {};
    await claimRunSlot(claim, { policy: 'enforced', userId: 'u1' });
    claim.handedOff = true;

    await releaseUnstartedRunSlot(claim, 'u1');
    expect(slots.releaseAgentRunSlot).not.toHaveBeenCalled();
  });
});
