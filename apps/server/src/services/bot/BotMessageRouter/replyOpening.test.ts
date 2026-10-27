import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplyOpening } from './replyOpening';

const CHANNEL = 'discord:guild-1:chan-1';

const makeThread = (id = CHANNEL) => ({
  id,
  post: vi.fn().mockResolvedValue(undefined),
  startTyping: vi.fn().mockResolvedValue(undefined),
});

const makeClient = () => ({
  canOpenReplyThread: (id: string) => id.split(':').length === 3,
  openThreadForChannelWake: vi.fn().mockResolvedValue(`${CHANNEL}:thread-9`),
});

describe('createReplyOpening', () => {
  let client: ReturnType<typeof makeClient>;
  const opener = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
      message: { raw: { id: 'msg-1' }, text: 'look into it' },
      thread,
      wakeKind: 'mention',
    });

  it('falls back to the previous behaviour when the model does not answer in time', async () => {
    opener.mockImplementation(() => new Promise(() => {}));
    const thread = makeThread();

    const result = await open(create({ timeoutMs: 20 }), thread);

    expect(opener.mock.calls[0][1].aborted).toBe(true);
    expect(client.openThreadForChannelWake).toHaveBeenCalledWith(
      CHANNEL,
      { id: 'msg-1' },
      undefined,
    );
    expect(thread.id).toBe(`${CHANNEL}:thread-9`);
    expect(thread.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      verdict: expect.objectContaining({ reason: 'thread:fallback-timeout', verdict: 'abstain' }),
    });
  });

  it('acknowledges in the channel when the thread it chose cannot be opened', async () => {
    opener.mockResolvedValue({ ack: 'On it.', placement: 'thread', title: 'Deploy' });
    client.openThreadForChannelWake.mockRejectedValue(new Error('missing permission'));
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
    expect(result).toEqual({});
  });

  it('does not decide on a platform that never opens reply threads', async () => {
    const service = create({
      client: { openThreadForChannelWake: client.openThreadForChannelWake },
    });

    await expect(service.decidesPlacement()).resolves.toBe(false);
  });
});
