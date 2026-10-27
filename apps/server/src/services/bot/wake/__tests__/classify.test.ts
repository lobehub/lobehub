// @vitest-environment node
import { TRACING_SCENARIOS } from '@lobechat/const';

import { createWakeClassify } from '../classify';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockDecide = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

const signal = { message: 'is the deploy done?', platformThreadId: 'discord:g:c', timestamp: 1 };

describe('createWakeClassify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ decide: mockDecide, generateObject: mockGenerateObject });
  });

  it('goes through generateObject under the bot_wake_classifier tracing scenario', async () => {
    mockGenerateObject.mockResolvedValue({
      addressedToBot: 0.8,
      kind: 'request',
      reason: 'asks about the deploy',
    });
    const abort = new AbortController();

    const result = await createWakeClassify({
      agentId: 'agt',
      db: {} as never,
      engine: 'chat',
      userId: 'u1',
    })({ customInstructions: 'billing only', signal }, abort.signal);

    expect(result).toEqual({
      addressedToBot: 0.8,
      kind: 'request',
      reason: 'asks about the deploy',
    });
    expect(TRACING_SCENARIOS.BotWakeClassifier).toBe('bot_wake_classifier');
    const [payload, options] = mockGenerateObject.mock.calls[0];
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'v2',
      scenario: 'bot_wake_classifier',
      schemaName: 'bot_wake_classifier',
    });
    expect(options.signal).toBe(abort.signal);
    expect(options.metadata.trigger).toBe('bot');
    expect(payload.schema.name).toBe('bot_wake_classifier');
    expect(payload.messages[1].content).toContain('billing only');
    expect(payload.messages[1].content).toContain('is the deploy done?');
  });

  it('reads the model the bot’s name and the conversation, with the bot labelled as the assistant', async () => {
    mockGenerateObject.mockResolvedValue({ addressedToBot: 0.9, kind: 'request', reason: 'named' });

    await createWakeClassify({ agentId: 'agt', db: {} as never, engine: 'chat', userId: 'u1' })(
      {
        conversation: {
          botNames: ['Shadow Arvin'],
          lastBotMessage: 'The rollout starts at noon.',
          recent: [
            {
              at: 1,
              authorId: 'bot-1',
              authorName: 'Shadow Arvin',
              id: 'm1',
              isBot: true,
              text: 'The rollout starts at noon.',
            },
            {
              at: 2,
              authorId: 'u2',
              authorName: 'Bob',
              id: 'm2',
              isBot: false,
              text: 'is it live?',
            },
          ],
        },
        signal: { ...signal, applicationId: 'bot-1', message: 'Shadow Arvin 听得到吗' },
      },
      new AbortController().signal,
    );

    const content = mockGenerateObject.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain('The assistant is called: Shadow Arvin');
    expect(content).toContain("Assistant's last message:");
    expect(content).toContain('Assistant: The rollout starts at noon.\nBob: is it live?');
    expect(content).toContain('Shadow Arvin 听得到吗');
  });

  it('judges a message with no conversation on the text alone, as before', async () => {
    mockGenerateObject.mockResolvedValue({ addressedToBot: 0.4, kind: 'other', reason: 'x' });

    await createWakeClassify({ db: {} as never, engine: 'chat', userId: 'u1' })(
      { signal },
      new AbortController().signal,
    );

    const content = mockGenerateObject.mock.calls[0][0].messages[1].content as string;
    expect(content).not.toContain('The assistant is called');
    expect(content).not.toContain('Earlier messages');
  });

  it.each([
    { addressedToBot: 1.5, kind: 'request', reason: 'x' },
    { addressedToBot: 0.5, kind: 'shout', reason: 'x' },
    { addressedToBot: 'high', kind: 'request', reason: 'x' },
    {},
  ])('rejects a malformed answer %j so the policy can degrade', async (answer) => {
    mockGenerateObject.mockResolvedValue(answer);

    await expect(
      createWakeClassify({ db: {} as never, engine: 'chat', userId: 'u1' })(
        { signal },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});

describe('createWakeClassify with a decision model (the default)', () => {
  const answer = (probability: number, choice = 'request') => ({
    answers: {
      addressed: { probability, type: 'boolean' },
      kind: { choice, type: 'choice' },
    },
    model: 'gpt-6-luna',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ decide: mockDecide, generateObject: mockGenerateObject });
  });

  it('asks the decision model, not a chat model, and reads the probability as the score', async () => {
    mockDecide.mockResolvedValue(answer(0.93));
    const abort = new AbortController();

    const result = await createWakeClassify({ db: {} as never, userId: 'u1' })(
      {
        conversation: { botNames: ['Shadow Arvin'], recent: [] },
        signal: { ...signal, message: 'Shadow Arvin 听得到吗' },
      },
      abort.signal,
    );

    expect(result).toMatchObject({ addressedToBot: 0.93, kind: 'request' });
    expect(mockGenerateObject).not.toHaveBeenCalled();
    const [payload, options] = mockDecide.mock.calls[0];
    expect(mockInit.mock.calls[0][2]).toBe('openai');
    expect(payload.model).toBe('gpt-6-luna:decision');
    expect(payload.questions.addressed.type).toBe('boolean');
    expect(payload.state).toContain('The assistant is called: Shadow Arvin');
    expect(payload.state).toContain('Shadow Arvin 听得到吗');
    // The deadline reaches the upstream call, so a late answer stops costing.
    expect(options.signal).toBe(abort.signal);
    expect(options.metadata.trigger).toBe('bot');
  });

  it('writes the decision call to llm_generation_tracing like any other generation', async () => {
    mockDecide.mockResolvedValue(answer(0.5));

    await createWakeClassify({ agentId: 'agt', db: {} as never, userId: 'u1' })(
      { signal },
      new AbortController().signal,
    );

    expect(mockDecide.mock.calls[0][1].tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'decision-v1',
      scenario: 'bot_wake_classifier',
      schemaName: 'bot_wake_decision',
    });
  });

  it('tells the model which agent the bot is and who owns it, and marks the owner’s lines', async () => {
    mockDecide.mockResolvedValue(answer(0.5));

    await createWakeClassify({ db: {} as never, userId: 'u1' })(
      {
        conversation: {
          agent: { name: 'Arvin Agent', title: 'Release helper' },
          botNames: ['Shadow Arvin'],
          ownerId: 'owner-1',
          ownerNames: ['Arvin Zhang'],
          recent: [
            { at: 1, authorId: 'owner-1', authorName: 'arvin', id: 'm1', isBot: false, text: 'hi' },
          ],
        },
        signal,
      },
      new AbortController().signal,
    );

    const state = mockDecide.mock.calls[0][0].state as string;
    expect(state).toContain('Its agent is named Arvin Agent (title: Release helper)');
    expect(state).toContain('is called: Arvin Zhang');
    expect(state).toContain('arvin (owner): hi');
  });

  it('can be pointed at a chat model such as DeepSeek flash instead', async () => {
    mockGenerateObject.mockResolvedValue({ addressedToBot: 0.7, kind: 'chitchat', reason: 'x' });

    await createWakeClassify({
      db: {} as never,
      engine: 'chat',
      model: 'deepseek-flash',
      provider: 'deepseek',
      userId: 'u1',
    })({ signal }, new AbortController().signal);

    expect(mockInit.mock.calls[0][2]).toBe('deepseek');
    expect(mockGenerateObject.mock.calls[0][0].model).toBe('deepseek-flash');
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('rejects a refused question so the policy degrades instead of guessing', async () => {
    mockDecide.mockResolvedValue({
      answers: {
        addressed: { reason: 'cannot say', type: 'refusal' },
        kind: { choice: 'other', type: 'choice' },
      },
      model: 'm',
    });

    await expect(
      createWakeClassify({ db: {} as never, userId: 'u1' })(
        { signal },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it('falls back to "other" when only the kind is refused, the score is still usable', async () => {
    mockDecide.mockResolvedValue({
      answers: { addressed: { probability: 0.2, type: 'boolean' }, kind: { type: 'refusal' } },
      model: 'm',
    });

    await expect(
      createWakeClassify({ db: {} as never, userId: 'u1' })(
        { signal },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ addressedToBot: 0.2, kind: 'other' });
  });

  it.each([-0.1, 1.2, Number.NaN])(
    'rejects an out-of-range probability %s',
    async (probability) => {
      mockDecide.mockResolvedValue(answer(probability));

      await expect(
        createWakeClassify({ db: {} as never, userId: 'u1' })(
          { signal },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    },
  );

  it('prepares the model runtime once for a burst of messages, not on every one', async () => {
    mockDecide.mockResolvedValue(answer(0.5));
    const classify = createWakeClassify({ db: {} as never, userId: 'u1' });

    await classify({ signal }, new AbortController().signal);
    await classify({ signal }, new AbortController().signal);

    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('retries the runtime after a failed preparation instead of caching the failure', async () => {
    mockInit.mockRejectedValueOnce(new Error('db down'));
    mockDecide.mockResolvedValue(answer(0.5));
    const classify = createWakeClassify({ db: {} as never, userId: 'u1' });

    await expect(classify({ signal }, new AbortController().signal)).rejects.toThrow('db down');
    await expect(classify({ signal }, new AbortController().signal)).resolves.toBeDefined();
  });
});
