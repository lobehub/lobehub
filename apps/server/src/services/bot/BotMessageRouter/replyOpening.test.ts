import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplyOpening, resetChannelClaims } from './replyOpening';

const CHANNEL = 'discord:guild-1:chan-1';

const makeThread = (id = CHANNEL) => ({
  id,
  post: vi.fn().mockResolvedValue(undefined),
  startTyping: vi.fn().mockResolvedValue(undefined),
});

/** Discord-shaped: the message arrives keyed by the channel, and a named thread opens on demand. */
const makeClient = () => {
  const openThread = vi.fn().mockResolvedValue(`${CHANNEL}:thread-9`);

  return {
    getReplyTargets: vi.fn((id: string) =>
      id.split(':').length === 3 ? { channel: id, namesThread: true, openThread } : undefined,
    ),
    openThread,
  };
};

describe('createReplyOpening', () => {
  let client: ReturnType<typeof makeClient>;
  const opener = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetChannelClaims();
    client = makeClient();
  });

  const create = (overrides: Partial<Parameters<typeof createReplyOpening>[0]> = {}) =>
    createReplyOpening({
      applicationId: 'app-1',
      client,
      mode: 'agent',
      opener,
      rolledOut: async () => true,
      ...overrides,
    });

  const open = (service: ReturnType<typeof create>, thread = makeThread()) =>
    service.open({
      message: { id: 'msg-1', raw: { id: 'msg-1' }, text: 'look into it' },
      thread,
      wakeKind: 'mention',
    });

  it('falls back to the previous behaviour when the model does not answer in time', async () => {
    opener.mockImplementation(() => new Promise(() => {}));
    const thread = makeThread();

    const result = await open(create({ timeoutMs: 20 }), thread);

    expect(opener.mock.calls[0][1].aborted).toBe(true);
    expect(client.getReplyTargets).toHaveBeenCalledWith(CHANNEL, {
      id: 'msg-1',
      raw: { id: 'msg-1' },
      text: 'look into it',
    });
    expect(client.openThread).toHaveBeenCalledWith(undefined);
    expect(thread.id).toBe(`${CHANNEL}:thread-9`);
    expect(thread.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      release: expect.any(Function),
      verdict: expect.objectContaining({ reason: 'thread:fallback-timeout', verdict: 'abstain' }),
    });
  });

  it('falls back on time when the conversation lookup stalls', async () => {
    const thread = makeThread();

    const result = await create({ timeoutMs: 20 }).open({
      conversation: () => new Promise(() => {}),
      message: { id: 'msg-1', raw: { id: 'msg-1' }, text: 'look into it' },
      thread,
      wakeKind: 'mention',
    });

    expect(opener).not.toHaveBeenCalled();
    expect(thread.id).toBe(`${CHANNEL}:thread-9`);
    expect(result.verdict?.reason).toBe('thread:fallback-timeout');
  });

  it('acknowledges in the channel when the thread it chose cannot be opened', async () => {
    opener.mockResolvedValue({ ack: 'On it.', placement: 'thread', title: 'Deploy' });
    client.openThread.mockRejectedValue(new Error('missing permission'));
    const thread = makeThread();

    const result = await open(create(), thread);

    expect(thread.id).toBe(CHANNEL);
    expect(thread.post).toHaveBeenCalledWith('On it.');
    expect(result.openingReply).toBe('On it.');
    expect(result.verdict?.reason).toBe('channel+ack');
  });

  it('does not tell the agent about an acknowledgement that failed to post', async () => {
    opener.mockResolvedValue({ ack: 'On it.', placement: 'channel' });
    const thread = makeThread();
    thread.post.mockRejectedValue(new Error('rate limited'));

    const result = await open(create(), thread);

    expect(result.openingReply).toBeUndefined();
    expect(result.verdict?.reason).toBe('channel');
  });

  it('shows typing while it decides', async () => {
    opener.mockResolvedValue({ placement: 'channel' });
    const thread = makeThread();

    await open(create(), thread);

    expect(thread.startTyping).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the owner keeps threads', { mode: 'thread' as const }],
    ['the rollout is off', { rolledOut: async () => false }],
    [
      'the rollout cannot be read',
      {
        rolledOut: async () => {
          throw new Error('down');
        },
      },
    ],
  ])('does not decide when %s', async (_, overrides) => {
    const service = create(overrides);

    await expect(service.decidesPlacement()).resolves.toBe(false);
    const result = await open(service);

    expect(opener).not.toHaveBeenCalled();
    expect(result).toEqual({ release: expect.any(Function) });
  });

  it('does not decide on a platform that never offers reply targets', async () => {
    const service = create({ client: {} });

    await expect(service.decidesPlacement()).resolves.toBe(false);
  });

  it('opens a thread instead when the bot is already answering in the channel', async () => {
    opener.mockResolvedValue({ placement: 'channel', title: '' });
    const thread = makeThread();

    const result = await open(create({ isBusy: (id) => id === CHANNEL }), thread);

    expect(thread.id).toBe(`${CHANNEL}:thread-9`);
    expect(result.verdict?.reason).toBe('thread:channel-busy');
  });

  it('does not pick a channel another opening has just picked, until that one is handed off', async () => {
    opener.mockResolvedValue({ ack: 'On it.', placement: 'channel', title: '' });
    let posted!: () => void;
    const first = makeThread();
    // The first acknowledgement is still being posted while the second opening decides.
    first.post.mockReturnValue(
      new Promise<void>((resolve) => {
        posted = resolve;
      }),
    );
    const second = makeThread();
    const service = create();

    const firstOpening = open(service, first);
    await vi.waitFor(() => expect(first.post).toHaveBeenCalled());
    const secondResult = await open(service, second);
    posted();
    const firstResult = await firstOpening;

    expect(first.id).toBe(CHANNEL);
    expect(second.id).toBe(`${CHANNEL}:thread-9`);
    expect(secondResult.verdict?.reason).toBe('thread:channel-busy+ack');

    // Once the first run is handed to the bridge, the channel is free again.
    firstResult.release();
    secondResult.release();
    const third = makeThread();
    await open(service, third);
    expect(third.id).toBe(CHANNEL);
  });

  it('answers a wake nobody asked for in the channel, without asking the model', async () => {
    const thread = makeThread();

    const result = await create().open({
      message: { id: 'msg-1', text: 'anyone?' },
      thread,
      wakeKind: 'followup',
    });

    expect(opener).not.toHaveBeenCalled();
    expect(thread.id).toBe(CHANNEL);
    expect(result.verdict?.reason).toBe('channel:followup');
  });

  describe('on a platform whose message arrives keyed by the thread under it (Slack)', () => {
    const SLACK_THREAD = 'slack:C1:111.222';
    const openSlackThread = vi.fn(async () => SLACK_THREAD);
    const slackClient = {
      getReplyTargets: () => ({
        channel: 'slack:C1',
        namesThread: false,
        openThread: openSlackThread,
      }),
    };

    it('moves a quick answer out of the thread into the channel', async () => {
      opener.mockResolvedValue({ placement: 'channel', title: '' });
      const thread = makeThread(SLACK_THREAD);

      const result = await open(create({ client: slackClient }), thread);

      expect(thread.id).toBe('slack:C1');
      expect(result.verdict?.reason).toBe('channel');
    });

    it('keeps the thread for longer work, without naming it', async () => {
      opener.mockResolvedValue({ ack: 'On it.', placement: 'thread', title: 'Deploy failure' });
      const thread = makeThread(SLACK_THREAD);

      const result = await open(create({ client: slackClient }), thread);

      expect(openSlackThread).toHaveBeenCalledWith(undefined);
      expect(thread.id).toBe(SLACK_THREAD);
      expect(thread.post).toHaveBeenCalledWith('On it.');
      expect(result.verdict?.reason).toBe('thread+ack');
    });

    it('keeps the thread when the model fails, as before', async () => {
      opener.mockRejectedValue(new Error('provider down'));
      const thread = makeThread(SLACK_THREAD);

      await open(create({ client: slackClient }), thread);

      expect(thread.id).toBe(SLACK_THREAD);
    });
  });
});
