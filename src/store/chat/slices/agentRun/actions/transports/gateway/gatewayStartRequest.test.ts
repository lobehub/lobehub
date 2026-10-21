import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';

import { interruptGatewayRunOnStop } from './gatewayStartRequest';
import { registerGatewayStopFreeze } from './stopFreeze';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { interruptTask: vi.fn() },
}));
vi.mock('@/services/shareChat', () => ({
  shareChatService: { interruptTask: vi.fn() },
}));

const stopSnapshot = { assistantMessageId: 'ast-1', content: 'shown so far' };

describe('interruptGatewayRunOnStop', () => {
  const unfreeze = vi.fn();
  let unregister: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    unregister?.();
    unregister = registerGatewayStopFreeze('gw-op', { freeze: () => stopSnapshot, unfreeze });
  });

  it('sends the frozen reply with an owner interrupt', async () => {
    // LOBE-14836: the server trims its stored reply to what the user saw at Stop.
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({ success: true } as any);

    const isOwnerRun = await interruptGatewayRunOnStop({
      gatewayOpId: 'gw-op',
      interrupt: { operationId: 'server-op', topicId: 'topic-1' },
      shareTopicId: 'topic-1',
    });

    expect(isOwnerRun).toBe(true);
    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({
      operationId: 'server-op',
      stopSnapshot,
      topicId: 'topic-1',
    });
    expect(unfreeze).not.toHaveBeenCalled();
  });

  it('renders the reply again when the owner interrupt fails', async () => {
    vi.mocked(aiAgentService.interruptTask).mockRejectedValue(new Error('network down'));

    await expect(
      interruptGatewayRunOnStop({
        gatewayOpId: 'gw-op',
        interrupt: { operationId: 'server-op' },
        shareTopicId: 'topic-1',
      }),
    ).rejects.toThrow('network down');
    expect(unfreeze).toHaveBeenCalledTimes(1);
  });

  it('sends a share visitor stop through the share mirror', async () => {
    vi.mocked(shareChatService.interruptTask).mockResolvedValue({} as any);

    const isOwnerRun = await interruptGatewayRunOnStop({
      agentShareId: 'share-1',
      gatewayOpId: 'gw-op',
      interrupt: { operationId: 'server-op' },
      shareTopicId: 'topic-1',
    });

    expect(isOwnerRun).toBe(false);
    expect(shareChatService.interruptTask).toHaveBeenCalledWith(
      'share-1',
      'topic-1',
      'server-op',
      stopSnapshot,
    );
    expect(aiAgentService.interruptTask).not.toHaveBeenCalled();
  });
});
