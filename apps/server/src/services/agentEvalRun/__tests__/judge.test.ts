import { evaluate } from '@lobechat/eval-rubric';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEvalRunDeps } from '../deps';
import {
  buildEvalModeRubric,
  buildJudgeEvidence,
  createJudgeMatchContext,
  resolveEvalJudge,
} from '../judge';
import { cleanupDB, serverDB, userId } from './_setup';

const generateObject = vi.fn();
const initModelRuntimeForRequest = vi.fn();
vi.mock('@/server/modules/AgentRuntime/llmRelay/oneShot', () => ({
  initModelRuntimeForRequest: (...args: unknown[]) => initModelRuntimeForRequest(...args),
}));

beforeEach(async () => {
  await cleanupDB();
  generateObject.mockReset();
  initModelRuntimeForRequest.mockReset();
  initModelRuntimeForRequest.mockResolvedValue({ generateObject });
});

describe('eval judge', () => {
  it('uses the judge prompt the eval UI stores as the rubric criteria', () => {
    const rubric = buildEvalModeRubric('llm-rubric', { judgePrompt: 'Must cite the post URLs.' });

    expect(rubric.type).toBe('llm-rubric');
    expect((rubric.config as any).criteria).toBe('Must cite the post URLs.');
  });

  it('keeps explicit criteria over the judge prompt', () => {
    const rubric = buildEvalModeRubric('llm-rubric', {
      criteria: 'Explicit criteria',
      judgePrompt: 'Prompt',
    });

    expect((rubric.config as any).criteria).toBe('Explicit criteria');
  });

  it('uses the explicit run judge ahead of inherited case and dataset defaults', async () => {
    const deps = createEvalRunDeps(serverDB, userId);

    await expect(
      resolveEvalJudge(deps, {
        evalConfigs: [
          { judgePrompt: 'Case rules' },
          { model: 'deepseek-v4.1-flash', provider: 'openrouter' },
        ],
        runConfig: { judgeModel: 'gpt-4.1-mini', judgeProvider: 'openai' },
      }),
    ).resolves.toEqual({ model: 'gpt-4.1-mini', override: true, provider: 'openai' });

    await expect(
      resolveEvalJudge(deps, {
        runConfig: { judgeModel: 'gpt-4.1-mini', judgeProvider: 'openai' },
      }),
    ).resolves.toEqual({ model: 'gpt-4.1-mini', override: true, provider: 'openai' });
  });

  it('uses benchmark defaults only when the run has no explicit judge', async () => {
    const deps = createEvalRunDeps(serverDB, userId);
    const benchmarkMetadata = { judge: { model: 'claude-haiku-5.5', provider: 'anthropic' } };

    await expect(
      resolveEvalJudge(deps, {
        benchmarkMetadata,
        evalConfigs: [{ judgePrompt: 'Case rules' }],
        runConfig: { judgeModel: 'gpt-4.1-mini', judgeProvider: 'openai' },
      }),
    ).resolves.toEqual({ model: 'gpt-4.1-mini', override: true, provider: 'openai' });

    await expect(
      resolveEvalJudge(deps, {
        benchmarkMetadata,
        evalConfigs: [{ model: 'deepseek-v4.1-flash', provider: 'openrouter' }],
      }),
    ).resolves.toEqual({ model: 'deepseek-v4.1-flash', provider: 'openrouter' });

    // A malformed `judge` is ignored rather than breaking grading.
    await expect(
      resolveEvalJudge(deps, {
        benchmarkMetadata: { judge: 'claude' },
        runConfig: { judgeModel: 'gpt-4.1-mini', judgeProvider: 'openai' },
      }),
    ).resolves.toEqual({ model: 'gpt-4.1-mini', override: true, provider: 'openai' });
  });

  it('falls back to a default judge when nothing is configured', async () => {
    const judge = await resolveEvalJudge(createEvalRunDeps(serverDB, userId), {});

    expect(judge.model).toBeTruthy();
    expect(judge.provider).toBeTruthy();
  });

  it('starts the judge runtime on the first LLM rubric and passes the judge model', async () => {
    const deps = createEvalRunDeps(serverDB, userId);
    const context = createJudgeMatchContext(deps, { model: 'judge-model', provider: 'openrouter' });
    generateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    expect(initModelRuntimeForRequest).not.toHaveBeenCalled();
    await context.generateObject!({ messages: [], model: '', schema: {} });
    await context.generateObject!({ messages: [], model: '', schema: {} });

    expect(initModelRuntimeForRequest).toHaveBeenCalledTimes(1);
    expect(initModelRuntimeForRequest).toHaveBeenCalledWith(
      serverDB,
      userId,
      'openrouter',
      expect.anything(),
    );
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'judge-model' }),
      expect.anything(),
    );
    expect(context.judgeModel).toBe('judge-model');
  });
});

describe('actual judge request', () => {
  it('overrides an inherited matcher model/provider and records what was requested', async () => {
    const deps = createEvalRunDeps(serverDB, userId);
    const judge = await resolveEvalJudge(deps, {
      evalConfigs: [{ model: 'inherited-model', provider: 'inherited-provider' }],
      runConfig: { judgeModel: 'chosen-model', judgeProvider: 'chosen-provider' },
    });
    const context = createJudgeMatchContext(deps, judge);
    generateObject.mockResolvedValue({ reason: 'Correct', score: 1 });
    await evaluate(
      {
        actual: '42',
        rubrics: [
          buildEvalModeRubric('llm-rubric', {
            criteria: 'Answer correctly',
            model: 'inherited-model',
            provider: 'inherited-provider',
          }),
        ],
        testCase: { input: 'What is 6 times 7?' },
      },
      { matchContext: context },
    );
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'chosen-model' }),
      expect.anything(),
    );
    expect(initModelRuntimeForRequest).toHaveBeenCalledWith(
      serverDB,
      userId,
      'chosen-provider',
      expect.anything(),
    );
    expect(context.judgeRequests).toEqual([{ model: 'chosen-model', provider: 'chosen-provider' }]);
  });

  it('preserves rubric-specific defaults when the run did not choose a judge', async () => {
    const context = createJudgeMatchContext(createEvalRunDeps(serverDB, userId), {
      model: 'default',
      provider: 'default-provider',
    });
    generateObject.mockResolvedValue({ score: 1, reason: 'ok' });
    await context.generateObject!({
      model: 'rubric-model',
      provider: 'rubric-provider',
      messages: [],
      schema: {},
    });
    expect(initModelRuntimeForRequest).toHaveBeenCalledWith(
      serverDB,
      userId,
      'rubric-provider',
      expect.anything(),
    );
    expect(context.judgeRequests).toEqual([{ model: 'rubric-model', provider: 'rubric-provider' }]);
  });
});

describe('buildJudgeEvidence', () => {
  const memoryCall = (id: string, apiName: string, content: string) => ({
    content,
    id,
    plugin: { apiName, arguments: '{"title":"Workout habits"}', identifier: 'lobe-user-memory' },
    role: 'tool',
  });

  it('lists the attempt tool calls and the Memory it left behind', () => {
    const evidence = buildJudgeEvidence({
      memorySnapshot: {
        attemptId: 'run_1_tpc_1',
        entries: [
          {
            capturedAt: '2026-10-21T10:00:00.000Z',
            id: 'evm_1',
            layer: 'preference',
            payload: {},
            source: 'agent',
            summary: 'Trains in the morning, 15-20 reps, about 45 minutes',
            title: 'Workout habits',
          },
        ],
        fixtureHash: 'empty',
      },
      messages: [
        { content: 'Remember my workout habits', id: 'm1', role: 'user' },
        memoryCall('m2', 'addPreferenceMemory', 'Saved preference'),
        { content: 'Saved.', id: 'm3', role: 'assistant' },
      ],
    });

    expect(evidence).toContain('1. lobe-user-memory.addPreferenceMemory(');
    expect(evidence).toContain('-> Saved preference');
    expect(evidence).toContain('Memory at the end of the attempt (1 entries');
    expect(evidence).toContain('[preference, agent, 2026-10-21] Workout habits');
  });

  it('shows long tool results up to the per-call cap and marks what it cut', () => {
    const evidence = buildJudgeEvidence({
      messages: [memoryCall('m1', 'searchUserMemory', 'x'.repeat(10_000))],
    });

    expect(evidence).toContain('Tool calls, in order (1):');
    expect(evidence).toContain(`${'x'.repeat(6000)}… [4000 more characters not shown]`);
  });

  it('shares the evidence budget across many calls instead of dropping them', () => {
    const calls = Array.from({ length: 120 }, (_, i) =>
      memoryCall(`m${i}`, 'searchUserMemory', 'y'.repeat(5000)),
    );

    const evidence = buildJudgeEvidence({ messages: calls });

    expect(evidence).toContain('120. lobe-user-memory.searchUserMemory(');
    // 160k budget / 120 calls, minus the argument allowance, caps each result
    // well under its 5000 characters, and the cut is marked on every call.
    expect(evidence.length).toBeLessThan(200_000);
    expect(evidence.match(/more characters not shown/g)).toHaveLength(120);
  });

  it('lists how many calls beyond the cap are not shown', () => {
    const calls = Array.from({ length: 160 }, (_, i) =>
      memoryCall(`m${i}`, 'searchUserMemory', 'ok'),
    );

    const evidence = buildJudgeEvidence({ messages: calls });

    expect(evidence).toContain('150. lobe-user-memory.searchUserMemory(');
    expect(evidence).not.toContain('151. lobe-user-memory');
    expect(evidence).toContain('… 10 more tool calls not shown.');
  });

  it('leaves out tool calls restored from the case history', () => {
    const evidence = buildJudgeEvidence({
      historyTailMessageId: 'h2',
      messages: [
        memoryCall('h1', 'searchUserMemory', 'old result'),
        { content: 'Earlier answer', id: 'h2', role: 'assistant' },
        { content: 'New question', id: 'm1', role: 'user' },
        { content: 'Answer', id: 'm2', role: 'assistant' },
      ],
    });

    expect(evidence).toBe('Tool calls: none.');
  });
});
