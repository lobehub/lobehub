// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InternalExecAgentParams } from '../types';
import {
  bindRunFee,
  claimRunFee,
  releaseUnstartedRunFee,
  type RunFeeClaim,
  shouldHoldRunFee,
} from './runFee';

const fees = vi.hoisted(() => ({
  holdAgentRunFee: vi.fn(),
  rebindAgentRunFee: vi.fn(),
  releaseAgentRunFee: vi.fn(),
}));

vi.mock('@/business/server/agent-run/runFee', () => fees);

const composerSend = {
  agentId: 'agt_1',
  interactiveStart: true,
  prompt: 'hi',
} as InternalExecAgentParams;

const holds = (params: Partial<InternalExecAgentParams>, workspaceId?: string) =>
  shouldHoldRunFee({ ...composerSend, ...params } as InternalExecAgentParams, { workspaceId });

describe('shouldHoldRunFee', () => {
  it('holds a fee for every run the user starts, foreground or background', () => {
    expect(holds({})).toBe(true);
    expect(holds({ parentMessageId: 'msg_1' })).toBe(true);
    expect(holds({ interactiveStart: false })).toBe(true);
    expect(holds({ trigger: 'cron' } as any)).toBe(true);
  });

  it('holds no fee for a continuation of a run that already holds one', () => {
    expect(holds({ resume: true } as any)).toBe(false);
    expect(holds({ resumeApproval: { decision: 'approved' } as any })).toBe(false);
    expect(holds({ resumeApprovals: [{ decision: 'approved' }] as any })).toBe(false);
    expect(holds({ resumeToolResult: { toolCallId: 't' } as any })).toBe(false);
    expect(holds({ approvalResolutionRequestId: 'req_1' } as any)).toBe(false);
    expect(holds({ steer: true } as any)).toBe(false);
  });

  it('holds no fee for sub-agent, group member and Workspace runs', () => {
    expect(holds({ parentOperationId: 'op_parent' })).toBe(false);
    expect(holds({ appContext: { isSubAgent: true } as any })).toBe(false);
    expect(holds({ appContext: { orchestrationRole: 'member' } as any })).toBe(false);
    expect(holds({}, 'ws_1')).toBe(false);
  });
});

describe('run fee claim', () => {
  beforeEach(() => {
    for (const fn of Object.values(fees)) fn.mockReset();
  });

  it('lets a refused hold propagate and keeps nothing to release', async () => {
    fees.holdAgentRunFee.mockRejectedValue(new Error('insufficient'));
    const claim: RunFeeClaim = {};

    await expect(claimRunFee(claim, { hold: true, userId: 'u1' })).rejects.toThrow('insufficient');
    await releaseUnstartedRunFee(claim, 'u1');

    expect(fees.releaseAgentRunFee).not.toHaveBeenCalled();
  });

  it('holds nothing when the run is exempt', async () => {
    const claim: RunFeeClaim = {};
    await claimRunFee(claim, { hold: false, userId: 'u1' });

    expect(fees.holdAgentRunFee).not.toHaveBeenCalled();
    expect(claim.holderId).toBeUndefined();
  });

  it('moves the fee to the operation and releases it when the run never started', async () => {
    const claim: RunFeeClaim = {};
    await claimRunFee(claim, { hold: true, userId: 'u1' });
    const provisional = claim.holderId;
    await bindRunFee(claim, 'u1', 'op_1');
    await releaseUnstartedRunFee(claim, 'u1');

    expect(fees.rebindAgentRunFee).toHaveBeenCalledWith('u1', provisional, 'op_1');
    expect(fees.releaseAgentRunFee).toHaveBeenCalledWith('u1', 'op_1');
  });

  it('leaves a started run’s fee to its completion', async () => {
    const claim: RunFeeClaim = {};
    await claimRunFee(claim, { hold: true, userId: 'u1' });
    claim.handedOff = true;
    await releaseUnstartedRunFee(claim, 'u1');

    expect(fees.releaseAgentRunFee).not.toHaveBeenCalled();
  });
});
