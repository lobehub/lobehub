// @vitest-environment node
import { createChannelReplyOpener, normalizeChannelReplyOpening } from './opener';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

const answer = {
  ack: '',
  acknowledge: false,
  placement: 'channel' as const,
  thread: '',
  title: '',
};
const threads = [{ label: 'T1', title: '表情包实现方案' }, { label: 'T2' }];

describe('createChannelReplyOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ generateObject: mockGenerateObject });
  });

  it('goes through generateObject under the channel_reply_opener tracing scenario', async () => {
    mockGenerateObject.mockResolvedValue({
      ...answer,
      ack: '这个接着在之前的 Thread 里说。',
      acknowledge: true,
      placement: 'existing_thread',
      thread: 'T1',
    });
    const abort = new AbortController();

    const opening = await createChannelReplyOpener({
      agentId: 'agt',
      channelId: 'chn',
      db: {} as never,
      userId: 'u1',
    })({ canOpenThread: true, message: '表情包再补一个动图', threads }, abort.signal);

    expect(opening).toEqual({
      ack: '这个接着在之前的 Thread 里说。',
      placement: 'existing_thread',
      thread: 'T1',
    });
    const [payload, options] = mockGenerateObject.mock.calls[0];
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'v2',
      scenario: 'channel_reply_opener',
      schemaName: 'channel_reply_opener',
    });
    expect(options.metadata).toEqual({ channelId: 'chn', trigger: 'channel' });
    expect(options.signal).toBe(abort.signal);
    expect(payload.messages[1].content).toContain('T1: 表情包实现方案');
  });

  it('rejects a malformed answer, so the caller starts in place', async () => {
    mockGenerateObject.mockResolvedValue({ placement: 'sideways' });

    await expect(
      createChannelReplyOpener({ db: {} as never, userId: 'u1' })(
        { canOpenThread: true, message: 'hi' },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});

describe('normalizeChannelReplyOpening', () => {
  it('keeps an existing Thread only when it was offered', () => {
    expect(
      normalizeChannelReplyOpening(
        { ...answer, placement: 'existing_thread', thread: 'T2' },
        { canOpenThread: true, threads },
      ),
    ).toEqual({ placement: 'existing_thread', thread: 'T2' });
    expect(
      normalizeChannelReplyOpening(
        { ...answer, placement: 'existing_thread', thread: 'T9' },
        { canOpenThread: true, threads },
      ),
    ).toEqual({ placement: 'channel' });
  });

  it('never continues in an existing Thread when other Agents were asked or no Thread is possible', () => {
    const picked = { ...answer, placement: 'existing_thread' as const, thread: 'T1' };
    expect(
      normalizeChannelReplyOpening(picked, {
        canOpenThread: true,
        coAddressed: [{ name: 'Alien' }],
        threads,
      }),
    ).toEqual({ placement: 'channel' });
    expect(normalizeChannelReplyOpening(picked, { canOpenThread: false, threads })).toEqual({
      placement: 'channel',
    });
  });

  it('opens a new Thread only with a title, and drops an empty acknowledgement', () => {
    expect(
      normalizeChannelReplyOpening(
        {
          ...answer,
          ack: ' 收到，\n我先看下。 ',
          acknowledge: true,
          placement: 'thread',
          title: '部署',
        },
        { canOpenThread: true },
      ),
    ).toEqual({ ack: '收到， 我先看下。', placement: 'thread', title: '部署' });
    expect(
      normalizeChannelReplyOpening({ ...answer, placement: 'thread' }, { canOpenThread: true }),
    ).toEqual({ placement: 'channel' });
  });

  it('posts only the sentence when the model writes its whole answer into the acknowledgement', () => {
    const leaked =
      '{"acknowledge":true,"ack":"我先查一下 lobot 目前好友添加和联系人列表的实际入口。","placement":"channel","thread":"","title":""}”】【注：需要输出 JSON object';
    expect(
      normalizeChannelReplyOpening(
        { ...answer, ack: leaked, acknowledge: true },
        { canOpenThread: true },
      ),
    ).toEqual({
      ack: '我先查一下 lobot 目前好友添加和联系人列表的实际入口。',
      placement: 'channel',
    });

    expect(
      normalizeChannelReplyOpening(
        { ...answer, ack: '{"acknowledge":true,"placement":"channel"', acknowledge: true },
        { canOpenThread: true },
      ),
    ).toEqual({ placement: 'channel' });
  });
});
