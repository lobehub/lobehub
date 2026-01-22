import { describe, expect, it } from 'vitest';

import { calculatorExecutor } from '../src/executor';

describe('Calculator Core Functions', () => {
  it('should handle number input in base conversion', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 255,
      fromBase: 10,
      toBase: 2,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('11111111');
  });

  it('should return only result for calculate', async () => {
    const result = await calculatorExecutor.calculate({
      expression: '2 + 3 * 4',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('14');
    expect(result.state?.result).toBe('14');
  });

  it('should return only result for evaluateExpression', async () => {
    const result = await calculatorExecutor.evaluateExpression({
      expression: 'x^2 + 2*x + 1',
      variables: { x: 5 },
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('36');
    expect(result.state?.result).toBe('36');
  });

  it('should handle precision in calculate', async () => {
    const result = await calculatorExecutor.calculate({
      expression: '10 / 3',
      precision: 2,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('3.33');
  });

  it('should handle complex expressions', async () => {
    const result = await calculatorExecutor.calculate({
      expression: 'sqrt(16)',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('4');
  });
});
