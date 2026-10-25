// @vitest-environment node
import { TRACING_SCENARIOS } from '@lobechat/const';

import { createWakeClassify } from '../classify';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

const signal = { message: 'is the deploy done?', platformThreadId: 'discord:g:c', timestamp: 1 };

describe('createWakeClassify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ generateObject: mockGenerateObject });
  });

  it('goes through generateObject under the bot_wake_classifier tracing scenario', async () => {
    mockGenerateObject.mockResolvedValue({
      addressedToBot: 0.8,
      kind: 'request',
      reason: 'asks about the deploy',
    });
    const abort = new AbortController();

    const result = await createWakeClassify({ agentId: 'agt', db: {} as never, userId: 'u1' })(
      { customInstructions: 'billing only', signal },
      abort.signal,
    );

    expect(result).toEqual({
      addressedToBot: 0.8,
      kind: 'request',
      reason: 'asks about the deploy',
    });
    expect(TRACING_SCENARIOS.BotWakeClassifier).toBe('bot_wake_classifier');
    const [payload, options] = mockGenerateObject.mock.calls[0];
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'v1',
      scenario: 'bot_wake_classifier',
      schemaName: 'bot_wake_classifier',
    });
    expect(options.signal).toBe(abort.signal);
    expect(options.metadata.trigger).toBe('bot');
    expect(payload.schema.name).toBe('bot_wake_classifier');
    expect(payload.messages[1].content).toContain('billing only');
    expect(payload.messages[1].content).toContain('is the deploy done?');
  });

  it.each([
    { addressedToBot: 1.5, kind: 'request', reason: 'x' },
    { addressedToBot: 0.5, kind: 'shout', reason: 'x' },
    { addressedToBot: 'high', kind: 'request', reason: 'x' },
    {},
  ])('rejects a malformed answer %j so the policy can degrade', async (answer) => {
    mockGenerateObject.mockResolvedValue(answer);

    await expect(
      createWakeClassify({ db: {} as never, userId: 'u1' })(
        { signal },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
