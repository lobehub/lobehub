import { describe, expect, it } from 'vitest';

import { calculatorExecutor } from '../src/executor';

describe('Calculator Base Conversion', () => {
  it('should convert binary to decimal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '1010',
      fromBase: 'binary',
      toBase: 'decimal',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('1010 (binary) = 10 (decimal)');
    expect(result.state?.decimalValue).toBe(10);
  });

  it('should convert decimal to binary', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '255',
      fromBase: 'decimal',
      toBase: 'binary',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('255 (decimal) = 0b11111111 (binary)');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should convert hexadecimal to octal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: 'FF',
      fromBase: 'hexadecimal',
      toBase: 'octal',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('FF (hexadecimal) = 0o377 (octal)');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should convert octal to hexadecimal', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '77',
      fromBase: 'octal',
      toBase: 'hexadecimal',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('77 (octal) = 0x3F (hexadecimal)');
    expect(result.state?.decimalValue).toBe(63);
  });

  it('should handle numbers with prefixes', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '0xFF',
      fromBase: 'hexadecimal',
      toBase: 'decimal',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('0xFF (hexadecimal) = 255 (decimal)');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should handle invalid numbers', async () => {
    const result = await calculatorExecutor.convertBase({
      number: '2AB',
      fromBase: 'binary',
      toBase: 'decimal',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ValidationError');
  });
});
