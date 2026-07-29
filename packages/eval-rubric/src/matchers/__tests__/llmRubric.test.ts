import type { EvalBenchmarkRubric } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { matchLLMRubric } from '../llmRubric';
import type { GenerateObjectPayload, MatchContext } from '../types';

const rubric = (
  config: any = {},
  overrides?: Partial<EvalBenchmarkRubric>,
): EvalBenchmarkRubric => ({
  config,
  id: 'test',
  name: 'test',
  type: 'llm-rubric',
  weight: 1,
  ...overrides,
});

describe('matchLLMRubric', () => {
  const mockGenerateObject =
    vi.fn<(payload: GenerateObjectPayload) => Promise<{ reason: string; score: number }>>();

  const context: MatchContext = {
    generateObject: mockGenerateObject,
    judgeModel: 'gpt-4o',
  };

  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  it('should pass when LLM returns high score', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Output is correct', score: 0.9 });

    const result = await matchLLMRubric({
      actual: 'Paris',
      context,
      expected: 'Paris',
      rubric: rubric({ criteria: 'Is the answer correct?' }),
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.9);
    expect(result.reason).toBe('Output is correct');
  });

  it('should fail when LLM returns low score', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Output is wrong', score: 0.2 });

    const result = await matchLLMRubric({
      actual: 'London',
      context,
      expected: 'Paris',
      rubric: rubric({ criteria: 'Is the answer correct?' }),
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.2);
    expect(result.reason).toBe('Output is wrong');
  });

  it('should respect custom threshold from rubric', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Partially correct', score: 0.5 });

    const result = await matchLLMRubric({
      actual: 'answer',
      context,
      rubric: rubric({ criteria: 'Check correctness' }, { threshold: 0.4 }),
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it('should clamp score to [0, 1]', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'overflow', score: 1.5 });

    const result = await matchLLMRubric({
      actual: 'x',
      context,
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.score).toBe(1);
  });

  it('should return score 0 when generateObject is not available', async () => {
    const result = await matchLLMRubric({ actual: 'x', rubric: rubric({ criteria: 'test' }) });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('LLM judge not available');
  });

  it('should handle LLM call failure gracefully', async () => {
    mockGenerateObject.mockRejectedValue(new Error('API timeout'));

    const result = await matchLLMRubric({
      actual: 'x',
      context,
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('LLM judge failed: API timeout');
  });

  it('should treat a valid score of 0 as a real score (not "no score")', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Completely fails', score: 0 });

    const result = await matchLLMRubric({
      actual: 'garbage',
      context,
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Completely fails');
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it('should retry when the judge returns no score, then succeed', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ reason: 'malformed' } as any)
      .mockResolvedValueOnce({ reason: 'recovered', score: 0.8 });

    const result = await matchLLMRubric({
      actual: 'x',
      context,
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.8);
    expect(result.reason).toBe('recovered');
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('should retry on a thrown error, then succeed', async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ reason: 'ok', score: 1 });

    const result = await matchLLMRubric({
      actual: 'x',
      context,
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('should give up after judgeMaxAttempts and report the last failure', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'still malformed' } as any);

    const result = await matchLLMRubric({
      actual: 'x',
      context: { ...context, judgeMaxAttempts: 2 },
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('LLM judge did not return a score');
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('should use rubric config model/provider over context judgeModel', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({
      actual: 'x',
      context,
      rubric: rubric({
        criteria: 'test',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      }),
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      }),
    );
  });

  it('should fallback to context.judgeModel when rubric config has no model', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({ actual: 'x', context, rubric: rubric({ criteria: 'test' }) });

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
  });

  it('should return score 0 when no judge model configured', async () => {
    const result = await matchLLMRubric({
      actual: 'x',
      context: { generateObject: mockGenerateObject },
      rubric: rubric({ criteria: 'test' }),
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('No judge model configured');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('should include input in user prompt when provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({
      actual: 'to Vercel',
      context,
      input: 'How do I deploy?',
      rubric: rubric({ criteria: 'Is this a good continuation?' }),
    });

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('[Input]');
    expect(userMsg.content).toContain('How do I deploy?');
  });

  it('should omit input section when not provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({ actual: 'x', context, rubric: rubric({ criteria: 'test' }) });

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).not.toContain('[Input]');
  });

  it('should include expected in user prompt when provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({
      actual: 'Paris',
      context,
      expected: 'Paris',
      rubric: rubric({ criteria: 'Check answer' }),
    });

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('[Expected]');
    expect(userMsg.content).toContain('Paris');
  });

  it('should omit expected section when not provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({
      actual: 'some output',
      context,
      rubric: rubric({ criteria: 'Is this helpful?' }),
    });

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).not.toContain('[Expected]');
    expect(userMsg.content).toContain('[Criteria]');
    expect(userMsg.content).toContain('[Output]');
  });

  it('should use custom systemRole from rubric config', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });
    const customSystemRole = 'You are a code review expert. Score code quality from 0 to 1.';

    await matchLLMRubric({
      actual: 'function add(a, b) { return a + b; }',
      context,
      rubric: rubric({ criteria: 'Is the code clean?', systemRole: customSystemRole }),
    });

    const payload = mockGenerateObject.mock.calls[0][0];
    const systemMsg = payload.messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toBe(customSystemRole);
  });

  it('should use default systemRole when not configured', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric({ actual: 'x', context, rubric: rubric({ criteria: 'test' }) });

    const payload = mockGenerateObject.mock.calls[0][0];
    const systemMsg = payload.messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toContain('expert evaluation judge');
  });
});
