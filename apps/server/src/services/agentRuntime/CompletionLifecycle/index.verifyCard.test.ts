// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '.';

const { createMessage, findOperation, findRun, findVerifyCard } = vi.hoisted(() => ({
  createMessage: vi.fn(),
  findOperation: vi.fn(),
  findRun: vi.fn(),
  findVerifyCard: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: findRun };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: findOperation };
  }),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { create: createMessage, findVerifyMessageByOperationId: findVerifyCard };
  }),
}));

const createVerifyMessage = (lifecycle: CompletionLifecycle) =>
  (lifecycle as any).createVerifyMessage('op-1', 'msg-final', 'user-1') as Promise<void>;

describe('CompletionLifecycle.createVerifyMessage', () => {
  beforeEach(() => {
    [createMessage, findOperation, findRun, findVerifyCard].forEach((m) => m.mockReset());
    findRun.mockResolvedValue({ plan: [{ id: 'c1' }] });
    findOperation.mockResolvedValue({ agentId: 'agt-1', id: 'op-1', topicId: 'tpc-1' });
    findVerifyCard.mockResolvedValue(undefined);
  });

  it('creates the delivery-checker card for a run with a plan', async () => {
    await createVerifyMessage(new CompletionLifecycle({} as any, 'user-1'));

    expect(findVerifyCard).toHaveBeenCalledWith('op-1', 'tpc-1');
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { verifyOperationId: 'op-1' },
        parentId: 'msg-final',
        role: 'verify',
        topicId: 'tpc-1',
      }),
    );
  });

  it('does not stack a second card when the completion is delivered again', async () => {
    // A heteroFinish the edge timed out is retried by the CLI up to 7 times;
    // each retry used to add one more card to the conversation.
    findVerifyCard.mockResolvedValue({ id: 'msg-card', role: 'verify' });

    await createVerifyMessage(new CompletionLifecycle({} as any, 'user-1'));

    expect(createMessage).not.toHaveBeenCalled();
  });
});
