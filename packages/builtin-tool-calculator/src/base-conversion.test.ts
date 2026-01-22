import { describe, expect, it } from 'vitest';

import { calculatorExecutor } from '../src/executor';

describe('Calculator Base Conversion', () => {
  it('should convert binary to decimal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '1010',
      fromBase: 2,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('10');
    expect(result.state?.decimalValue).toBe(10);
  });

  it('should convert decimal to binary', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '255',
      fromBase: 10,
      toBase: 2,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('11111111');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should convert hexadecimal to octal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 'FF',
      fromBase: 16,
      toBase: 8,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('377');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should convert octal to hexadecimal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '77',
      fromBase: 8,
      toBase: 16,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('3F');
    expect(result.state?.decimalValue).toBe(63);
  });

  it('should handle hexadecimal input', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 'FF',
      fromBase: 16,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('255');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should handle invalid numbers', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '2AB',
      fromBase: 2,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should support bases 2-36 with numeric input', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 'Z',
      fromBase: 36,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('35');
    expect(result.state?.decimalValue).toBe(35);
  });

  it('should convert decimal to base 32', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '1000',
      fromBase: 10,
      toBase: 32,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('V8');
    expect(result.state?.decimalValue).toBe(1000);
  });

  it('should handle invalid base numbers', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '123',
      fromBase: 1,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should handle invalid base 37', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '123',
      fromBase: 10,
      toBase: 37,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should validate digit characters for base', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 'G',
      fromBase: 16,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });
});
