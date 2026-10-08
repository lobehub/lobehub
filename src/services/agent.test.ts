import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { agentService } from './agent';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { agent: { updateAgentConfig: { mutate: vi.fn() } } },
}));

describe('agent config working directory request contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([{ path: '/new-project' }, undefined])(
    'marks only explicitly submitted devices for replacement (%j)',
    async (selection) => {
      const config = { agencyConfig: { workingDirByDevice: { 'device-a': selection } } };
      await agentService.updateAgentConfig('agent-1', config);

      expect(lambdaClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          replaceWorkingDirDeviceIds: ['device-a'],
          value: config,
        },
        { context: { showNotification: false }, signal: undefined },
      );
    },
  );

  it('does not mark cached devices when updating an unrelated config field', async () => {
    await agentService.updateAgentConfig('agent-1', { agencyConfig: { executionTarget: 'local' } });
    expect(lambdaClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        replaceWorkingDirDeviceIds: [],
        value: { agencyConfig: { executionTarget: 'local' } },
      },
      { context: { showNotification: false }, signal: undefined },
    );
  });
});
