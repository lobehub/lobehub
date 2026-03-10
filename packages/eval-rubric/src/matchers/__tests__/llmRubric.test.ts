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

    const result = await matchLLMRubric(
      'Paris',
      'Paris',
      rubric({ criteria: 'Is the answer correct?' }),
      context,
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.9);
    expect(result.reason).toBe('Output is correct');
  });

  it('should fail when LLM returns low score', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Output is wrong', score: 0.2 });

    const result = await matchLLMRubric(
      'London',
      'Paris',
      rubric({ criteria: 'Is the answer correct?' }),
      context,
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.2);
    expect(result.reason).toBe('Output is wrong');
  });

  it('should respect custom threshold from rubric', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'Partially correct', score: 0.5 });

    const result = await matchLLMRubric(
      'answer',
      undefined,
      rubric({ criteria: 'Check correctness' }, { threshold: 0.4 }),
      context,
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it('should clamp score to [0, 1]', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'overflow', score: 1.5 });

    const result = await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }), context);

    expect(result.score).toBe(1);
  });

  it('should return score 0 when generateObject is not available', async () => {
    const result = await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }));

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('LLM judge not available');
  });

  it('should handle LLM call failure gracefully', async () => {
    mockGenerateObject.mockRejectedValue(new Error('API timeout'));

    const result = await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }), context);

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('LLM judge failed: API timeout');
  });

  it('should use rubric config model/provider over context judgeModel', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric(
      'x',
      undefined,
      rubric({
        criteria: 'test',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      }),
      context,
    );

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      }),
    );
  });

  it('should fallback to context.judgeModel when rubric config has no model', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }), context);

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
  });

  it('should return score 0 when no judge model configured', async () => {
    const result = await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }), {
      generateObject: mockGenerateObject,
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('No judge model configured');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('should include expected in user prompt when provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric('Paris', 'Paris', rubric({ criteria: 'Check answer' }), context);

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('[Expected]');
    expect(userMsg.content).toContain('Paris');
  });

  it('should omit expected section when not provided', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric(
      'some output',
      undefined,
      rubric({ criteria: 'Is this helpful?' }),
      context,
    );

    const payload = mockGenerateObject.mock.calls[0][0];
    const userMsg = payload.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).not.toContain('[Expected]');
    expect(userMsg.content).toContain('[Criteria]');
    expect(userMsg.content).toContain('[Output]');
  });

  it('should use custom systemRole from rubric config', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });
    const customSystemRole = 'You are a code review expert. Score code quality from 0 to 1.';

    await matchLLMRubric(
      'function add(a, b) { return a + b; }',
      undefined,
      rubric({ criteria: 'Is the code clean?', systemRole: customSystemRole }),
      context,
    );

    const payload = mockGenerateObject.mock.calls[0][0];
    const systemMsg = payload.messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toBe(customSystemRole);
  });

  it('should use default systemRole when not configured', async () => {
    mockGenerateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await matchLLMRubric('x', undefined, rubric({ criteria: 'test' }), context);

    const payload = mockGenerateObject.mock.calls[0][0];
    const systemMsg = payload.messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toContain('expert evaluation judge');
  });
});
