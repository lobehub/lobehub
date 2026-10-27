// @vitest-environment node
import { emitAgentSignalScenarioEvent, enqueueAgentSignalSourceEvent } from '../../emitter';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getUserPreference: vi.fn(),
  triggerRun: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/utils/agent-access', () => ({ assertAgentUsableBy: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserPreference = mocks.getUserPreference;
  },
}));
vi.mock('@/server/workflows/agentSignal', () => ({
  AgentSignalWorkflow: { triggerRun: mocks.triggerRun },
}));
vi.mock('../../orchestrator', () => ({ executeAgentSignalSourceEvent: mocks.execute }));

const input = {
  payload: { agentId: 'agt', message: 'hi', platform: 'discord' },
  sourceId: 'm1',
  sourceType: 'bot.message.merged',
} as const;
const context = { agentId: 'agt', db: {} as never, userId: 'u1' };

describe('emitAgentSignalScenarioEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ deduped: false, orchestration: {} });
  });

  it.each([
    { botWakeConfig: undefined, expectedRuns: 0, name: 'no bot config' },
    { botWakeConfig: { enabled: false }, expectedRuns: 0, name: 'bot wake disabled' },
    { botWakeConfig: { enabled: true, mode: 'off' as const }, expectedRuns: 0, name: 'mode off' },
    { botWakeConfig: { enabled: true, mode: 'shadow' as const }, expectedRuns: 1, name: 'shadow' },
    {
      botWakeConfig: { enabled: true, mode: 'enforce' as const },
      expectedRuns: 1,
      name: 'enforce',
    },
  ])('bot-wake with $name runs the pipeline $expectedRuns time(s)', async (c) => {
    const result = await emitAgentSignalScenarioEvent('bot-wake', input, context, {
      botWakeConfig: c.botWakeConfig,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(c.expectedRuns);
    expect(result === undefined).toBe(c.expectedRuns === 0);
  });

  it('awaits the orchestration result inline, tagged with the scenario, and never uses the workflow', async () => {
    const expected = { deduped: false, orchestration: { marker: 1 } };
    mocks.execute.mockResolvedValue(expected);

    const result = await emitAgentSignalScenarioEvent('bot-wake', input, context, {
      botWakeConfig: { enabled: true, mode: 'enforce' },
    });

    expect(result).toBe(expected);
    expect(mocks.execute).toHaveBeenCalledWith(
      input,
      context,
      expect.objectContaining({ scenario: 'bot-wake' }),
    );
    expect(mocks.triggerRun).not.toHaveBeenCalled();
    expect(mocks.getUserPreference).not.toHaveBeenCalled();
  });

  it('refuses to await an async scenario', async () => {
    await expect(emitAgentSignalScenarioEvent('self-iteration', input, context)).rejects.toThrow(
      /is async/,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('self-iteration gating is unchanged', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { accepted: true, name: 'Labs on', preference: { lab: { enableSelfLearning: true } } },
    { accepted: false, name: 'Labs off', preference: { lab: { enableSelfLearning: false } } },
  ])('enqueue with $name -> accepted=$accepted', async ({ accepted, preference }) => {
    mocks.triggerRun.mockResolvedValue({ workflowRunId: 'wf' });
    mocks.getUserPreference.mockResolvedValue(preference);

    const result = await enqueueAgentSignalSourceEvent(input, {
      agentId: 'agt',
      userId: `u-${accepted}`,
    });

    expect(result.accepted).toBe(accepted);
    expect(mocks.triggerRun).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });
});
