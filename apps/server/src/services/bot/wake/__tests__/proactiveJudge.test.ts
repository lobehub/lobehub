// @vitest-environment node
import { createWakeProactiveJudge } from '../classify';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockDecide = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

const owner = { id: 'o1', isBot: false, isMe: false, isOwner: true, isSystem: false };
const signal = {
  author: owner,
  message: '哎 这个 UI 一眼看上去还是太 vibe 了，得想想怎么refine',
  platformThreadId: 'discord:g:c',
  timestamp: 1,
};
const conversation = { botNames: ['Nasa'], recent: [] };

describe('createWakeProactiveJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ decide: mockDecide, generateObject: mockGenerateObject });
  });

  it('asks the decision model whether to step in, not whether it was addressed', async () => {
    mockDecide.mockResolvedValue({ answers: { helpful: { probability: 0.81, type: 'boolean' } } });
    const abort = new AbortController();

    const result = await createWakeProactiveJudge({
      agentId: 'agt',
      db: {} as never,
      userId: 'u1',
    })({ conversation, signal }, abort.signal);

    expect(result).toEqual({ helpful: 0.81, reason: 'gpt-6-luna:decision p=0.81' });
    const [payload, options] = mockDecide.mock.calls[0];
    expect(Object.keys(payload.questions)).toEqual(['helpful']);
    expect(payload.state).toContain('Newest message (written by the owner):');
    expect(payload.state).toContain('The assistant is called: Nasa');
    expect(options.signal).toBe(abort.signal);
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'proactive-v1',
      scenario: 'bot_wake_classifier',
      schemaName: 'bot_wake_proactive_decision',
    });
  });

  it('rejects a refused question so the policy abstains instead of guessing', async () => {
    mockDecide.mockResolvedValue({ answers: { helpful: { reason: 'unsure', type: 'refusal' } } });

    await expect(
      createWakeProactiveJudge({ db: {} as never, userId: 'u1' })(
        { conversation, signal },
        new AbortController().signal,
      ),
    ).rejects.toThrow('decision model refused: unsure');
  });

  it('can use a chat model through generateObject', async () => {
    mockGenerateObject.mockResolvedValue({ helpful: 0.3, reason: 'just a remark' });

    const result = await createWakeProactiveJudge({
      db: {} as never,
      engine: 'chat',
      userId: 'u1',
    })({ conversation, signal }, new AbortController().signal);

    expect(result).toEqual({ helpful: 0.3, reason: 'just a remark' });
    const [payload] = mockGenerateObject.mock.calls[0];
    expect(payload.schema.name).toBe('bot_wake_proactive');
    expect(payload.messages[0].content).toContain('step in, unasked');
  });
});
