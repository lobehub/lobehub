import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitRemoteHeteroIntervention } from './remoteHeteroIntervention';

const mocks = vi.hoisted(() => ({ lambdaMutate: vi.fn(), shareSubmit: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { aiAgent: { submitHeteroIntervention: { mutate: mocks.lambdaMutate } } },
}));
vi.mock('@/services/shareChat', () => ({
  shareChatService: { submitHeteroIntervention: mocks.shareSubmit },
}));

const base = { operationId: 'op-1', resolutionRequestId: 'req-1', toolCallId: 'tool-1' };
const cancelled = { ...base, cancelReason: 'user_cancelled', cancelled: true };

describe('submitRemoteHeteroIntervention', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a share visitor answer through the share endpoint', async () => {
    await submitRemoteHeteroIntervention(
      { agentShareId: 'share-1', topicId: 'topic-1' },
      { ...base, actionType: 'submit', payload: { answer: 'yes' } },
    );

    expect(mocks.shareSubmit).toHaveBeenCalledWith('share-1', 'topic-1', {
      ...base,
      result: { answer: 'yes' },
    });
    expect(mocks.lambdaMutate).not.toHaveBeenCalled();
  });

  it('uses the owner endpoint without a share, defaulting the result to {}', async () => {
    await submitRemoteHeteroIntervention({ topicId: 'topic-1' }, { ...base, actionType: 'submit' });

    expect(mocks.lambdaMutate).toHaveBeenCalledWith({ ...base, result: {} });
    expect(mocks.shareSubmit).not.toHaveBeenCalled();
  });

  it('uses the owner endpoint when a share has no topic yet', async () => {
    await submitRemoteHeteroIntervention(
      { agentShareId: 'share-1' },
      { ...base, actionType: 'submit' },
    );

    expect(mocks.lambdaMutate).toHaveBeenCalled();
    expect(mocks.shareSubmit).not.toHaveBeenCalled();
  });

  it.each(['skip', 'cancel'] as const)('maps %s to a user cancellation', async (actionType) => {
    await submitRemoteHeteroIntervention({ topicId: 'topic-1' }, { ...base, actionType });
    expect(mocks.lambdaMutate).toHaveBeenCalledWith(cancelled);

    await submitRemoteHeteroIntervention(
      { agentShareId: 'share-1', topicId: 'topic-1' },
      { ...base, actionType },
    );
    expect(mocks.shareSubmit).toHaveBeenCalledWith('share-1', 'topic-1', cancelled);
  });
});
