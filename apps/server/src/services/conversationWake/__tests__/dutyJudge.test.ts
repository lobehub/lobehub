// @vitest-environment node
import { createWakeDutyJudge } from '../dutyJudge';

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockDecide = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mockInit }));

const teammate = { id: 'bob', isBot: false, isMe: false, isOwner: false, isSystem: false };
const signal = {
  author: teammate,
  message: '要是导出能保留文件夹结构就好了',
  platformThreadId: 'discord:g:c',
  timestamp: 1,
};
const conversation = { botNames: ['Nasa'], recent: [] };
const DUTIES = '- 群里有人描述需求时评估一下，简单的给 dario 建任务\n- PR 提了之后通知提需求的人';

describe('createWakeDutyJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue({ decide: mockDecide, generateObject: mockGenerateObject });
  });

  it('asks the decision model whether the message is within the duties, which one, and whether stepping in helps', async () => {
    mockDecide.mockResolvedValue({
      answers: {
        duty: { choice: 'duty-1', type: 'choice' },
        helpful: { probability: 0.42, type: 'boolean' },
        inDuty: { probability: 0.86, type: 'boolean' },
      },
    });
    const abort = new AbortController();

    const result = await createWakeDutyJudge({ agentId: 'agt', db: {} as never, userId: 'u1' })(
      { conversation, duties: DUTIES, signal },
      abort.signal,
    );

    expect(result).toEqual({
      duty: '群里有人描述需求时评估一下，简单的给 dario 建任务',
      helpful: 0.42,
      inDuty: 0.86,
      reason: 'gpt-6-luna:decision p=0.86 helpful=0.42',
    });
    const [payload, options] = mockDecide.mock.calls[0];
    expect(Object.keys(payload.questions).sort()).toEqual(['duty', 'helpful', 'inDuty']);
    expect(payload.state).toContain("The assistant's duties, written by its owner:");
    expect(payload.state).toContain('The assistant is called: Nasa');
    // Anyone's message is judged; nothing marks it as the owner's.
    expect(payload.state).toContain('Newest message:\n');
    expect(options.signal).toBe(abort.signal);
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'duty-v3',
      scenario: 'bot_wake_classifier',
      schemaName: 'bot_wake_duty_decision',
    });
  });

  it('names the only duty without asking, and keeps the score when the choice is lost', async () => {
    mockDecide.mockResolvedValueOnce({
      answers: { inDuty: { probability: 0.9, type: 'boolean' } },
    });
    const judge = createWakeDutyJudge({ db: {} as never, userId: 'u1' });

    await expect(
      judge({ conversation, duties: 'Triage bug reports.', signal }, new AbortController().signal),
    ).resolves.toMatchObject({ duty: 'Triage bug reports.', helpful: undefined, inDuty: 0.9 });
    expect(Object.keys(mockDecide.mock.calls[0][0].questions)).toEqual(['inDuty', 'helpful']);

    mockDecide.mockResolvedValueOnce({
      answers: {
        duty: { reason: 'unsure', type: 'refusal' },
        inDuty: { probability: 0.4, type: 'boolean' },
      },
    });
    const refused = await judge(
      { conversation, duties: DUTIES, signal },
      new AbortController().signal,
    );
    expect(refused).toMatchObject({ inDuty: 0.4 });
    expect(refused.duty).toBeUndefined();
  });

  it('rejects a refused score so the policy abstains instead of guessing', async () => {
    mockDecide.mockResolvedValue({ answers: { inDuty: { reason: 'unsure', type: 'refusal' } } });

    await expect(
      createWakeDutyJudge({ db: {} as never, userId: 'u1' })(
        { conversation, duties: DUTIES, signal },
        new AbortController().signal,
      ),
    ).rejects.toThrow('decision model refused: unsure');
  });

  it('can use a chat model through generateObject, which names the duty by key', async () => {
    mockGenerateObject.mockResolvedValue({
      duty: 'duty-2',
      helpful: 0.2,
      inDuty: 0.3,
      reason: 'just a remark',
    });

    const result = await createWakeDutyJudge({
      db: {} as never,
      engine: 'chat',
      userId: 'u1',
    })({ conversation, duties: DUTIES, signal }, new AbortController().signal);

    expect(result).toEqual({
      duty: 'PR 提了之后通知提需求的人',
      helpful: 0.2,
      inDuty: 0.3,
      reason: 'just a remark',
    });
    const [payload, options] = mockGenerateObject.mock.calls[0];
    expect(payload.schema.name).toBe('bot_wake_duty');
    expect(payload.schema.schema.properties.duty.enum).toEqual(['duty-1', 'duty-2', 'none']);
    expect(payload.schema.schema.required).toEqual(['inDuty', 'helpful', 'duty', 'reason']);
    expect(payload.messages[0].content).toContain('falls within its duties');
    expect(payload.messages[0].content).toContain('"helpful" high:');
    expect(payload.messages[1].content).toContain('PR 提了之后通知提需求的人');
    expect(options.tracing).toMatchObject({
      promptVersion: 'duty-v3',
      schemaName: 'bot_wake_duty',
    });
  });

  it('names no duty when the chat model picks none, and the only one when there is one', async () => {
    const judge = createWakeDutyJudge({ db: {} as never, engine: 'chat', userId: 'u1' });

    mockGenerateObject.mockResolvedValueOnce({ duty: 'none', inDuty: 0.1, reason: 'chatter' });
    const none = await judge(
      { conversation, duties: DUTIES, signal },
      new AbortController().signal,
    );
    expect(none.duty).toBeUndefined();

    mockGenerateObject.mockResolvedValueOnce({ inDuty: 0.9, reason: 'a bug report' });
    await expect(
      judge({ conversation, duties: 'Triage bug reports.', signal }, new AbortController().signal),
    ).resolves.toMatchObject({ duty: 'Triage bug reports.', inDuty: 0.9 });
  });

  describe('a duty longer than 120 characters', () => {
    const long =
      '当有人在群里描述一个新需求、并且说明了使用场景和期望的结果时，先判断复杂度：简单的需求直接在 LobeHub 里给 dario 建一个任务，写清楚需求原文和验收标准，然后在原消息下回复任务链接；复杂的需求先和提需求的人确认范围，再拆成多个任务分给对应的人，PR 提了之后通知提需求的人';
    const duties = `- ${long}\n- 每周五下午汇总本周的线上报错`;

    it('keeps the whole duty the decision model chose', async () => {
      mockDecide.mockResolvedValue({
        answers: {
          duty: { choice: 'duty-1', type: 'choice' },
          inDuty: { probability: 0.9, type: 'boolean' },
        },
      });

      const result = await createWakeDutyJudge({ db: {} as never, userId: 'u1' })(
        { conversation, duties, signal },
        new AbortController().signal,
      );

      expect(result.duty).toBe(long);
    });

    it('keeps the whole duty the chat model named by key', async () => {
      mockGenerateObject.mockResolvedValue({ duty: 'duty-1', inDuty: 0.9, reason: 'a request' });

      const result = await createWakeDutyJudge({ db: {} as never, engine: 'chat', userId: 'u1' })(
        { conversation, duties, signal },
        new AbortController().signal,
      );

      expect(result.duty).toBe(long);
      expect(mockGenerateObject.mock.calls[0][0].messages[0].content).toContain(
        `- duty-1: ${long}`,
      );
    });
  });
});
