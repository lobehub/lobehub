// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openChannelReply } from './replyOpening';

const { executions } = vi.hoisted(() => ({
  executions: { open: vi.fn(), openingCandidate: vi.fn() },
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/server/services/bot/wake/opener', () => ({ createReplyOpener: vi.fn() }));

const candidate = {
  agent: { id: 'agt-coder', name: 'Coder', title: 'Engineer' },
  canOpenThread: true,
  recent: [
    {
      author: { id: 'user-1', name: 'Mia', type: 'user' },
      content: 'The deploy is red again',
      id: 'm1',
    },
    {
      author: { id: 'agt-coder', name: 'Coder', type: 'agent' },
      content: 'Looking',
      id: 'm2',
    },
  ],
  request: { author: { id: 'user-1', name: 'Mia', type: 'user' }, content: 'Why?', id: 'm3' },
  requesterUserId: 'user-1',
  workspaceId: null,
};

describe('openChannelReply', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executions.openingCandidate.mockResolvedValue(candidate);
    executions.open.mockResolvedValue(true);
  });

  it('asks the opener with the conversation and applies an acknowledgement and a Thread', async () => {
    const opener = vi.fn().mockResolvedValue({
      ack: 'Got it, I will check the deploy logs first.',
      placement: 'thread',
      title: 'Red deploy',
    });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    expect(opener).toHaveBeenCalledWith(
      {
        ackPlacement: 'before-thread',
        agent: { name: 'Coder', title: 'Engineer' },
        botNames: ['Coder'],
        canOpenThread: true,
        message: 'Why?',
        recentMessages: ['Mia: The deploy is red again', 'Assistant: Looking'],
      },
      expect.any(AbortSignal),
    );
    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: 'Got it, I will check the deploy logs first.',
      threadTitle: 'Red deploy',
    });
  });

  it('calls an Agent without a name by its title', async () => {
    executions.openingCandidate.mockResolvedValue({
      ...candidate,
      agent: { id: 'agt-coder', name: null, title: '小澄' },
    });
    const opener = vi.fn().mockResolvedValue({ placement: 'channel' });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    expect(opener).toHaveBeenCalledWith(
      expect.objectContaining({ agent: { name: undefined, title: '小澄' }, botNames: ['小澄'] }),
      expect.any(AbortSignal),
    );
  });

  it('answers in place without a word when the opener says so', async () => {
    const opener = vi.fn().mockResolvedValue({ placement: 'channel' });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: undefined,
      threadTitle: undefined,
    });
  });

  it('records a slow opener as an opening that changed nothing', async () => {
    const opener = vi.fn(() => new Promise<never>(() => {}));

    await openChannelReply({} as never, 'channel', 'job', {
      createOpener: () => opener,
      timeoutMs: 10,
    });

    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: undefined,
      threadTitle: undefined,
    });
  });

  it('skips a job with nothing to open and never throws', async () => {
    const opener = vi.fn();
    executions.openingCandidate.mockResolvedValueOnce(undefined);
    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });
    expect(opener).not.toHaveBeenCalled();

    executions.openingCandidate.mockRejectedValueOnce(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
