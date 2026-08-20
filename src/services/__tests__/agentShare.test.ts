import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { agentShareService } from '@/services/agentShare';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentShare: {
      disableShare: { mutate: vi.fn() },
      enableShare: { mutate: vi.fn() },
      getShareStatus: { query: vi.fn() },
      updateShareConfig: { mutate: vi.fn() },
      updateVisibility: { mutate: vi.fn() },
    },
  },
}));

describe('AgentShareService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards share lifecycle calls', async () => {
    await agentShareService.enableShare('agent-1');
    await agentShareService.getShareStatus('agent-1');
    await agentShareService.updateVisibility('agent-1', 'link');
    await agentShareService.disableShare('agent-1');

    expect(lambdaClient.agentShare.enableShare.mutate).toHaveBeenCalledWith({
      agentId: 'agent-1',
    });
    expect(lambdaClient.agentShare.getShareStatus.query).toHaveBeenCalledWith({
      agentId: 'agent-1',
    });
    expect(lambdaClient.agentShare.updateVisibility.mutate).toHaveBeenCalledWith({
      agentId: 'agent-1',
      visibility: 'link',
    });
    expect(lambdaClient.agentShare.disableShare.mutate).toHaveBeenCalledWith({
      agentId: 'agent-1',
    });
  });

  it('forwards the complete share configuration', async () => {
    const config = {
      allowReadMemory: true,
      enabledToolIds: ['search'],
      filePermissionConfig: {
        agentFiles: 'read' as const,
        knowledgeBase: 'read' as const,
        uploadAllowed: true,
      },
      maxTopicsPerVisitor: 10,
      maxTurnsPerTopic: 40,
    };

    await agentShareService.updateShareConfig('agent-1', config);

    expect(lambdaClient.agentShare.updateShareConfig.mutate).toHaveBeenCalledWith({
      agentId: 'agent-1',
      config,
    });
  });
});
