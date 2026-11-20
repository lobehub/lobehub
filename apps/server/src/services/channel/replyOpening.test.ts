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
vi.mock('./opener', () => ({
  CHANNEL_REPLY_OPENER_TIMEOUT_MS: 5000,
  createChannelReplyOpener: vi.fn(),
}));
// Unknown by default: the Agent's last run was not refused by a usage window.
vi.mock('./quotaReset', () => ({ knownQuotaReset: vi.fn() }));

const candidate = {
  addressed: true,
  agent: { id: 'agt-coder', name: 'Coder', title: 'Engineer' },
  canOpenThread: true,
  coAddressed: [],
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
  threads: [],
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
        agent: { name: 'Coder', title: 'Engineer' },
        botNames: ['Coder'],
        canOpenThread: true,
        coAddressed: [],
        message: 'Why?',
        recentMessages: ['Mia: The deploy is red again', 'Assistant: Looking'],
        threads: [],
      },
      expect.any(AbortSignal),
    );
    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: 'Got it, I will check the deploy logs first.',
      threadTitle: 'Red deploy',
    });
  });

  it('shows the open Threads by label and continues in the one the opener picks', async () => {
    executions.openingCandidate.mockResolvedValue({
      ...candidate,
      threads: [
        { id: 'cht_near', lastMessage: `latest ${'x'.repeat(200)}`, title: 'Red deploy' },
        { id: 'cht_far', root: 'Emoji  reactions\nplan' },
      ],
    });
    const opener = vi.fn().mockResolvedValue({
      ack: 'I will pick this up in the earlier thread.',
      placement: 'existing_thread',
      thread: 'T2',
    });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    const [input] = opener.mock.calls[0];
    expect(input.threads).toEqual([
      {
        label: 'T1',
        lastMessage: `latest ${'x'.repeat(153)}…`,
        root: undefined,
        title: 'Red deploy',
      },
      { label: 'T2', lastMessage: undefined, root: 'Emoji reactions plan', title: undefined },
    ]);
    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: 'I will pick this up in the earlier thread.',
      threadId: 'cht_far',
      threadTitle: undefined,
    });
  });

  it('tells the opener which other Agents the request asked, by the names people call them', async () => {
    executions.openingCandidate.mockResolvedValue({
      ...candidate,
      coAddressed: [
        { name: 'Alien', title: null },
        { name: null, title: '数据分析师' },
      ],
    });
    const opener = vi.fn().mockResolvedValue({ placement: 'channel' });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    expect(opener).toHaveBeenCalledWith(
      expect.objectContaining({
        coAddressed: [{ name: 'Alien' }, { name: '数据分析师', title: '数据分析师' }],
      }),
      expect.any(AbortSignal),
    );
  });

  it('tells the opener when the Agent was woken without being addressed', async () => {
    executions.openingCandidate.mockResolvedValue({ ...candidate, addressed: false });
    const opener = vi.fn().mockResolvedValue({ placement: 'channel' });

    await openChannelReply({} as never, 'channel', 'job', { createOpener: () => opener });

    expect(opener).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Why?', notAddressed: true }),
      expect.any(AbortSignal),
    );
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

  it('does not acknowledge when the Agent’s usage window is known to be closed', async () => {
    const opener = vi.fn();
    const quotaReset = vi.fn().mockResolvedValue(Date.parse('2026-11-18T07:00:00Z'));

    await openChannelReply({} as never, 'channel', 'job', {
      createOpener: () => opener,
      quotaReset,
    });

    expect(quotaReset).toHaveBeenCalledWith(candidate);
    expect(opener).not.toHaveBeenCalled();
    // Opened with nothing, so the run starts in place and its refusal is the reply's outcome.
    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {});
  });

  it('acknowledges as usual when the usage check fails', async () => {
    const opener = vi.fn().mockResolvedValue({ ack: 'On it.', placement: 'channel' });

    await openChannelReply({} as never, 'channel', 'job', {
      createOpener: () => opener,
      quotaReset: vi.fn().mockRejectedValue(new Error('db down')),
    });

    expect(executions.open).toHaveBeenCalledWith('channel', 'job', {
      ack: 'On it.',
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
