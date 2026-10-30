// @vitest-environment node
import { createReplyOpener, normalizeReplyOpening } from '../opener';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

describe('createReplyOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ generateObject: mockGenerateObject });
  });

  it('goes through generateObject under the bot_reply_opener tracing scenario', async () => {
    mockGenerateObject.mockResolvedValue({
      ack: '收到，我先翻下部署日志。',
      acknowledge: true,
      placement: 'thread',
      title: '部署失败排查',
    });
    const abort = new AbortController();

    const opening = await createReplyOpener({ agentId: 'agt', db: {} as never, userId: 'u1' })(
      { canOpenThread: true, message: '帮我查下昨天部署失败的原因' },
      abort.signal,
    );

    expect(opening).toEqual({
      ack: '收到，我先翻下部署日志。',
      placement: 'thread',
      title: '部署失败排查',
    });
    const [payload, options] = mockGenerateObject.mock.calls[0];
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'v1',
      scenario: 'bot_reply_opener',
      schemaName: 'bot_reply_opener',
    });
    expect(options.signal).toBe(abort.signal);
    expect(options.metadata.trigger).toBe('bot');
    expect(payload.schema.name).toBe('bot_reply_opener');
    expect(payload.messages[1].content).toContain('帮我查下昨天部署失败的原因');
  });

  it('rejects a malformed answer, so the caller falls back', async () => {
    mockGenerateObject.mockResolvedValue({ placement: 'sideways' });

    await expect(
      createReplyOpener({ db: {} as never, userId: 'u1' })(
        { canOpenThread: true, message: 'hi' },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it('prepares the model runtime once and reuses it', async () => {
    mockGenerateObject.mockResolvedValue({
      ack: '',
      acknowledge: false,
      placement: 'channel',
      title: '',
    });
    const open = createReplyOpener({ db: {} as never, userId: 'u1' });

    await open({ canOpenThread: true, message: 'a' }, new AbortController().signal);
    await open({ canOpenThread: true, message: 'b' }, new AbortController().signal);

    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeReplyOpening', () => {
  const answer = { ack: '', acknowledge: false, placement: 'channel' as const, title: '' };

  it('answers in the channel when a thread cannot open here, whatever the model said', () => {
    expect(
      normalizeReplyOpening({ ...answer, placement: 'thread', title: 'Deploy' }, false),
    ).toEqual({ placement: 'channel' });
  });

  it('does not open a thread it cannot name', () => {
    expect(normalizeReplyOpening({ ...answer, placement: 'thread', title: '   ' }, true)).toEqual({
      placement: 'channel',
    });
  });

  it('posts no acknowledgement unless the model chose to acknowledge with words', () => {
    expect(normalizeReplyOpening({ ...answer, ack: 'On it.' }, true)).toEqual({
      placement: 'channel',
    });
    expect(normalizeReplyOpening({ ...answer, ack: '  ', acknowledge: true }, true)).toEqual({
      placement: 'channel',
    });
  });

  it('keeps the acknowledgement and the title on one short line', () => {
    const opening = normalizeReplyOpening(
      {
        ack: 'Got it,\n\nchecking the logs first.',
        acknowledge: true,
        placement: 'thread',
        title: `Deploy ${'x'.repeat(100)}`,
      },
      true,
    );

    expect(opening.ack).toBe('Got it, checking the logs first.');
    expect(opening.title).toHaveLength(60);
  });
});
