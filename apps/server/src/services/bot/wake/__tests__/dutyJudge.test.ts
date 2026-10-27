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

  it('asks the decision model whether the message is within the duties, and which one', async () => {
    mockDecide.mockResolvedValue({
      answers: {
        duty: { choice: 'duty-1', type: 'choice' },
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
      inDuty: 0.86,
      reason: 'gpt-6-luna:decision p=0.86',
    });
    const [payload, options] = mockDecide.mock.calls[0];
    expect(Object.keys(payload.questions).sort()).toEqual(['duty', 'inDuty']);
    expect(payload.state).toContain("The assistant's duties, written by its owner:");
    expect(payload.state).toContain('The assistant is called: Nasa');
    // Anyone's message is judged; nothing marks it as the owner's.
    expect(payload.state).toContain('Newest message:\n');
    expect(options.signal).toBe(abort.signal);
    expect(options.tracing).toMatchObject({
      agentId: 'agt',
      promptVersion: 'duty-v1',
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
    ).resolves.toMatchObject({ duty: 'Triage bug reports.', inDuty: 0.9 });
    expect(Object.keys(mockDecide.mock.calls[0][0].questions)).toEqual(['inDuty']);

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

  it('can use a chat model through generateObject', async () => {
    mockGenerateObject.mockResolvedValue({
      duty: '  评估需求\n并建任务 ',
      inDuty: 0.3,
      reason: 'just a remark',
    });

    const result = await createWakeDutyJudge({
      db: {} as never,
      engine: 'chat',
      userId: 'u1',
    })({ conversation, duties: DUTIES, signal }, new AbortController().signal);

    expect(result).toEqual({ duty: '评估需求 并建任务', inDuty: 0.3, reason: 'just a remark' });
    const [payload] = mockGenerateObject.mock.calls[0];
    expect(payload.schema.name).toBe('bot_wake_duty');
    expect(payload.messages[0].content).toContain('falls within its duties');
    expect(payload.messages[1].content).toContain('PR 提了之后通知提需求的人');
  });
});
