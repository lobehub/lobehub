import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveExecutionPlan } from '@/helpers/executionTarget';

import { type RuntimeExecutorContext } from '../context';
import { buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * A `callSubAgent` child used to re-route from scratch. With no device of its
 * own, an agent in `local` mode fell back to the agent-level `boundDeviceId` —
 * a value written by whichever machine last picked "this device" — so with two
 * desktops online every parent ran on one machine and every child on the other.
 * The child must run on the device its parent is actually bound to.
 */
describe('buildServerVirtualSubAgentRunner device inheritance', () => {
  // The desktop the parent run executes on (it sends its own id).
  const PARENT_DEVICE = '838d6e154b6dbf342b9410cf58857a9d';
  // A second online desktop left in `agencyConfig.boundDeviceId` by an earlier pick.
  const STALE_BOUND_DEVICE = '1aab3a739730a7db2f070246daa68be4';
  const agencyConfig = {
    boundDeviceId: STALE_BOUND_DEVICE,
    executionTarget: 'local' as const,
    workingDirByDevice: { [PARENT_DEVICE]: { path: 'D:\\Sourcecode\\JuLink.W001' } },
  };
  const onlineDeviceIds = [PARENT_DEVICE, STALE_BOUND_DEVICE];

  const buildRunner = () => {
    const execVirtualSubAgent = vi.fn().mockResolvedValue({ operationId: 'child-op' });
    const ctx = {
      execVirtualSubAgent,
      messageModel: { create: vi.fn().mockResolvedValue({ id: 'placeholder-id' }) },
      operationId: 'parent-op',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    const runner = buildServerVirtualSubAgentRunner(
      ctx,
      {
        binding: { device: { id: PARENT_DEVICE } },
        operationId: 'parent-op',
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
        plan: { execution: { deviceId: PARENT_DEVICE, kind: 'device', target: 'local' } },
        world: { agent: { agencyConfig } as any },
      } as unknown as AgentState,
      { id: 'tool-call-1' } as ChatToolPayload,
      'parent-message-1',
    );

    return { execVirtualSubAgent, runner };
  };

  it('[R1] parent and callSubAgent child resolve to the same device', async () => {
    const { execVirtualSubAgent, runner } = buildRunner();

    await runner!.run({ description: 'task', instruction: 'run hostname' });

    const forwarded = execVirtualSubAgent.mock.calls[0][0];
    const parentPlan = resolveExecutionPlan({
      agencyConfig,
      clientExecutionAvailable: true,
      localDeviceId: PARENT_DEVICE,
      onlineDeviceIds,
      requestedDeviceId: PARENT_DEVICE,
    });
    const childPlan = resolveExecutionPlan({
      agencyConfig,
      clientExecutionAvailable: true,
      localDeviceId: forwarded.localDeviceId,
      onlineDeviceIds,
      requestedDeviceId: forwarded.deviceId,
    });

    expect(childPlan).toEqual(parentPlan);
    expect(childPlan).toMatchObject({ deviceId: PARENT_DEVICE, kind: 'device' });
  });

  it('forwards the parent device to a named callAgent target only as its "local" device', async () => {
    const { execVirtualSubAgent, runner } = buildRunner();

    await runner!.run({ agentId: 'target-agent', description: 'task', instruction: 'do it' });

    // A named agent keeps its own execution target (it may be sandbox-only), so
    // the parent device must not force it onto a device; it only answers what
    // "this machine" means for a target that is `local`.
    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: undefined, localDeviceId: PARENT_DEVICE }),
    );
  });
});
