import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeIntent, normalizeSynthesis, TaskIntentService } from './intent';

const { generateObject, resolveGoalModelConfig } = vi.hoisted(() => ({
  generateObject: vi.fn(),
  resolveGoalModelConfig: vi.fn(),
}));

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(() => ({ generateObject })),
}));

vi.mock('@/server/services/goal/modelConfig', () => ({ resolveGoalModelConfig }));

const wellFormed = {
  clarifications: [],
  confidence: 'high',
  kind: 'task',
  kindReason: 'A single deliverable.',
  refinedInstruction: 'Fix the typo in the README title.',
  summary: 'You want the README typo fixed.',
  title: 'Fix README typo',
};

describe('TaskIntentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGoalModelConfig.mockResolvedValue({ model: 'mini', provider: 'openai' });
    generateObject.mockResolvedValue(wellFormed);
  });

  it('reads the draft with the task-intent prompt, schema, and tracing scenario', async () => {
    const result = await new TaskIntentService({} as any, 'user-1', 'workspace-1').analyze({
      context: 'Assigned agent: Docs Bot',
      instruction: 'fix the readme typo',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mini',
        provider: 'openai',
        schema: expect.objectContaining({ name: 'task_intent' }),
      }),
      expect.objectContaining({
        tracing: {
          promptVersion: 'v1',
          scenario: 'task_intent',
          schemaName: 'task_intent',
        },
      }),
    );
    expect(result.title).toBe('Fix README typo');
  });

  it('rejects a malformed reading rather than returning a half-filled one', async () => {
    generateObject.mockResolvedValue({ title: 'Fix README typo' });

    await expect(
      new TaskIntentService({} as any, 'user-1').analyze({ instruction: 'fix the readme typo' }),
    ).rejects.toThrow('did not match the expected shape');
  });
});

describe('normalizeIntent', () => {
  it('drops a high-confidence claim that comes with a question', () => {
    const result = normalizeIntent(
      {
        ...wellFormed,
        clarifications: [{ question: 'Which repo?' }],
        confidence: 'high',
      } as any,
      'fix the readme typo',
    );

    // Left as 'high', the composer's gate would create the task straight
    // through and silently discard the question the model just raised.
    expect(result.confidence).toBe('medium');
    expect(result.clarifications).toHaveLength(1);
  });

  it('keeps at most three questions and discards blank ones', () => {
    const result = normalizeIntent(
      {
        ...wellFormed,
        clarifications: [
          { question: ' Which repo? ', options: [' a ', '', 'b'] },
          { question: 'By when?' },
          { question: '   ' },
          { question: 'Who reviews?' },
          { question: 'Which branch?' },
        ],
      } as any,
      'fix the readme typo',
    );

    expect(result.clarifications.map((item) => item.question)).toEqual([
      'Which repo?',
      'By when?',
      'Who reviews?',
    ]);
    expect(result.clarifications[0].options).toEqual(['a', 'b']);
  });

  it('falls back to the user text when the model returns a blank brief', () => {
    const result = normalizeIntent(
      { ...wellFormed, refinedInstruction: '   ' } as any,
      'fix the readme typo',
    );

    expect(result.refinedInstruction).toBe('fix the readme typo');
  });
});

describe('normalizeSynthesis', () => {
  it('keeps a rewrite that carried every literal through', () => {
    const result = normalizeSynthesis(
      {
        instruction:
          '把 https://example.com/spec 整理成 API 表格，交付格式为 PDF，覆盖全部 12 个接口。',
        title: '整理 API 表格',
      },
      '把 https://example.com/spec 整理成表格，一共 12 个接口',
    );

    expect(result.instruction).toContain('https://example.com/spec');
    expect(result.title).toBe('整理 API 表格');
  });

  it('rejects a rewrite that dropped a URL the draft carried', () => {
    // The executor would be left acting on a brief missing the only concrete
    // thing it was given, which is worse than not rewriting at all.
    expect(() =>
      normalizeSynthesis(
        { instruction: '把那篇文档整理成 API 表格。', title: '整理 API 表格' },
        '把 https://example.com/spec 整理成表格',
      ),
    ).toThrow(/dropped literals/);
  });

  it('rejects a rewrite that dropped a number the draft carried', () => {
    expect(() =>
      normalizeSynthesis(
        { instruction: '把接口整理成表格。', title: '整理表格' },
        '把 12 个接口整理成表格',
      ),
    ).toThrow(/dropped literals/);
  });
});
