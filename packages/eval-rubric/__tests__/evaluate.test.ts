import type { EvalBenchmarkRubric, EvalTestCaseContent } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { evaluate } from '../src';

const equalsRubric: EvalBenchmarkRubric = {
  config: { value: '' },
  id: 'r1',
  name: 'Exact Match',
  type: 'equals',
  weight: 1,
};

describe('evaluate', () => {
  it('should pass when actual matches expected', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: 'What is 6*7?' };
    const result = await evaluate({ actual: '42', rubrics: [equalsRubric], testCase });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('should fail when actual does not match', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: 'What is 6*7?' };
    const result = await evaluate({ actual: '41', rubrics: [equalsRubric], testCase });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('should handle multi-candidate expected (JSON array)', async () => {
    const testCase: EvalTestCaseContent = {
      expected: JSON.stringify(['孙悟空', '悟空', '齐天大圣']),
      input: '西游记主角是谁?',
    };
    const result = await evaluate({ actual: '悟空', rubrics: [equalsRubric], testCase });
    expect(result.passed).toBe(true);
  });

  it('should use extractor from options', async () => {
    const testCase: EvalTestCaseContent = {
      choices: ['0', '1', '2', '3'],
      expected: '1',
      input: 'Find all c in Z_3...',
    };
    const result = await evaluate(
      { actual: 'The answer is B', rubrics: [equalsRubric], testCase },
      {
        extractor: { type: 'choice-index' },
      },
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('should use extractor from rubric over options', async () => {
    const rubricWithExtractor: EvalBenchmarkRubric = {
      ...equalsRubric,
      extractor: { type: 'delimiter', delimiter: '####' },
    };
    const testCase: EvalTestCaseContent = { expected: '9', input: 'Calculate...' };
    const result = await evaluate({
      actual: 'blah blah #### 9',
      rubrics: [rubricWithExtractor],
      testCase,
    });
    expect(result.passed).toBe(true);
  });

  it('should compute weighted score across rubrics', async () => {
    const rubrics: EvalBenchmarkRubric[] = [
      { ...equalsRubric, id: 'r1', weight: 2 },
      { ...equalsRubric, id: 'r2', type: 'contains', weight: 1 },
    ];
    const testCase: EvalTestCaseContent = { expected: '42', input: '...' };
    // equals fails (actual != expected), contains passes (actual contains '42')
    const result = await evaluate({ actual: 'The answer is 42', rubrics, testCase });
    // equals: 0 * 2 = 0, contains: 1 * 1 = 1, total = 1/3 ≈ 0.33
    expect(result.score).toBeCloseTo(1 / 3, 2);
    expect(result.passed).toBe(false); // below 0.6 threshold
  });

  it('should use default contains when no rubrics but expected exists', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: '...' };
    const result = await evaluate({ actual: 'The answer is 42', rubrics: [], testCase });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.rubricResults).toHaveLength(1);
    expect(result.rubricResults[0].rubricId).toBe('default-contains');
  });

  it('should fail with default contains when actual does not contain expected', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: '...' };
    const result = await evaluate({ actual: 'I have no idea', rubrics: [], testCase });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rubricResults).toHaveLength(1);
    expect(result.rubricResults[0].rubricId).toBe('default-contains');
  });

  it('should return failed with no rubrics and no expected', async () => {
    const testCase: EvalTestCaseContent = { input: '...' };
    const result = await evaluate({ actual: '42', rubrics: [], testCase });
    expect(result.passed).toBe(false);
    expect(result.rubricResults).toHaveLength(0);
  });

  it('should respect custom passThreshold', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: '...' };
    const rubrics: EvalBenchmarkRubric[] = [
      { ...equalsRubric, id: 'r1', weight: 1 },
      { ...equalsRubric, id: 'r2', type: 'contains', weight: 1 },
    ];
    // equals fails, contains passes → score = 0.5
    const result = await evaluate(
      { actual: 'The answer is 42', rubrics, testCase },
      { passThreshold: 0.5 },
    );
    expect(result.passed).toBe(true);
  });
});

describe('evaluate - MMLU end-to-end', () => {
  it('should correctly evaluate MMLU-style question', async () => {
    const testCase: EvalTestCaseContent = {
      choices: ['0', '1', '2', '3'],
      expected: '1',
      input: 'Find all c in Z_3 such that Z_3[x]/(x^2 + c) is a field.',
    };

    const rubrics: EvalBenchmarkRubric[] = [
      {
        config: { value: '' },
        id: 'mmlu-match',
        name: 'Choice Match',
        type: 'equals',
        weight: 1,
      },
    ];

    // Agent says "B" → extractor maps to index 1 → matches expected "1"
    const result = await evaluate(
      { actual: 'The answer is B', rubrics, testCase },
      { extractor: { type: 'choice-index' }, passThreshold: 0.6 },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.rubricResults[0].passed).toBe(true);
  });

  it('should fail when agent gives wrong answer', async () => {
    const testCase: EvalTestCaseContent = {
      choices: ['0', '1', '2', '3'],
      expected: '1',
      input: 'Find all c in Z_3...',
    };

    const result = await evaluate(
      { actual: 'I think the answer is C', rubrics: [equalsRubric], testCase },
      { extractor: { type: 'choice-index' } },
    );

    expect(result.passed).toBe(false); // C → 2, expected 1
  });

  it('should handle MMLU with verbose reasoning before answer', async () => {
    const testCase: EvalTestCaseContent = {
      choices: ['True, True', 'False, False', 'True, False', 'False, True'],
      expected: '2',
      input: 'Statement 1 | Every element of a group generates a cyclic subgroup...',
    };

    const result = await evaluate(
      {
        actual:
          'Let me think step by step.\nStatement 1 is true because...\nStatement 2 is false because S_10 has 10! elements.\nTherefore the answer is C.',
        rubrics: [equalsRubric],
        testCase,
      },
      { extractor: { type: 'choice-index' } },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });
});

describe('evaluate - GSM8K end-to-end', () => {
  const numericRubric: EvalBenchmarkRubric = {
    config: { tolerance: 0.01, value: 0 },
    id: 'gsm8k-numeric',
    name: 'Numeric Match',
    type: 'numeric',
    weight: 1,
  };

  it('should extract answer after #### delimiter and match numerically', async () => {
    const testCase: EvalTestCaseContent = {
      expected: '9',
      input: 'Janet sells 16-3-4=<<16-3-4=9>>9 duck eggs. How many?',
    };

    const result = await evaluate({
      actual:
        'Janet has 16 eggs. She eats 3 and bakes 4. So 16-3-4=9 eggs remain.\n\nThe answer is 9.',
      rubrics: [
        {
          ...numericRubric,
          extractor: { type: 'last-line' },
        },
      ],
      testCase,
    });

    expect(result.passed).toBe(true);
  });

  it('should handle GSM8K delimiter extraction', async () => {
    const testCase: EvalTestCaseContent = {
      expected: '42',
      input: 'A store sells...',
    };

    const result = await evaluate({
      actual: 'First we calculate... then we add... #### 42',
      rubrics: [
        {
          ...numericRubric,
          extractor: { type: 'delimiter', delimiter: '####' },
        },
      ],
      testCase,
    });

    expect(result.passed).toBe(true);
  });

  it('should handle decimal tolerance', async () => {
    const testCase: EvalTestCaseContent = {
      expected: '3.14',
      input: 'What is pi to 2 decimal places?',
    };

    const result = await evaluate({
      actual: '3.14159',
      rubrics: [{ ...numericRubric, config: { tolerance: 0.01, value: 3.14 } }],
      testCase,
    });

    expect(result.passed).toBe(true);
  });
});

describe('evaluate - browsecomp-zh / xbench style', () => {
  it('should match with contains for short answer in long output', async () => {
    const containsRubric: EvalBenchmarkRubric = {
      config: { value: '' },
      id: 'contains-match',
      name: 'Contains Match',
      type: 'contains',
      weight: 1,
    };
    const testCase: EvalTestCaseContent = {
      expected: '161.27元',
      input: '某产品的价格是多少?',
    };

    const result = await evaluate({
      actual: '根据查询结果，该产品的售价为161.27元，目前有货。',
      rubrics: [containsRubric],
      testCase,
    });

    expect(result.passed).toBe(true);
  });

  it('should handle multi-candidate Chinese answers', async () => {
    const testCase: EvalTestCaseContent = {
      expected: JSON.stringify(['孙悟空', '悟空', '齐天大圣', '美猴王']),
      input: '西游记中大闹天宫的是谁?',
    };

    // Test with different valid answers
    expect((await evaluate({ actual: '齐天大圣', rubrics: [equalsRubric], testCase })).passed).toBe(
      true,
    );
    expect((await evaluate({ actual: '美猴王', rubrics: [equalsRubric], testCase })).passed).toBe(
      true,
    );
    expect((await evaluate({ actual: '猪八戒', rubrics: [equalsRubric], testCase })).passed).toBe(
      false,
    );
  });

  it('should handle xbench style with single round answer', async () => {
    const testCase: EvalTestCaseContent = {
      expected: '1轮',
      input: '某比赛第几轮?',
    };

    const result = await evaluate({ actual: '1轮', rubrics: [equalsRubric], testCase });
    expect(result.passed).toBe(true);
  });
});

describe('evaluate - edge cases', () => {
  it('should handle empty actual output', async () => {
    const testCase: EvalTestCaseContent = { expected: '42', input: '...' };
    const result = await evaluate({ actual: '', rubrics: [equalsRubric], testCase });
    expect(result.passed).toBe(false);
  });

  it('should handle undefined expected', async () => {
    const testCase: EvalTestCaseContent = { input: '...' };
    const result = await evaluate({ actual: 'anything', rubrics: [equalsRubric], testCase });
    // empty string vs 'anything' → fails
    expect(result.passed).toBe(false);
  });

  it('should handle whitespace-only output with extractor', async () => {
    const testCase: EvalTestCaseContent = { expected: '1', input: '...' };
    const result = await evaluate(
      { actual: '   \n  \n  ', rubrics: [equalsRubric], testCase },
      { extractor: { type: 'last-line' } },
    );
    expect(result.passed).toBe(false);
  });

  it('should handle multiple rubrics with different extractors', async () => {
    const rubrics: EvalBenchmarkRubric[] = [
      {
        config: { value: '' },
        extractor: { type: 'choice-index' },
        id: 'choice',
        name: 'Choice',
        type: 'equals',
        weight: 1,
      },
      {
        config: { value: '' },
        id: 'raw-contains',
        name: 'Raw Contains',
        type: 'contains',
        weight: 1,
      },
    ];
    const testCase: EvalTestCaseContent = {
      expected: '1',
      input: '...',
    };

    // "B" → choice-index extracts "1" → equals "1" ✓
    // raw output "The answer is B" contains "1"? No → ✗
    const result = await evaluate({ actual: 'The answer is B', rubrics, testCase });
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.rubricResults[0].passed).toBe(true);
    expect(result.rubricResults[1].passed).toBe(false);
  });
});
