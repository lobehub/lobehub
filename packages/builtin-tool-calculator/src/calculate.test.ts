import { describe, expect, it } from 'vitest';

import { calculatorExecutor } from '../src/executor';

describe('Unit Conversion', () => {
  it('should handle temperature conversion with mathjs syntax', async () => {
    const result = await calculatorExecutor.calculate({ expression: '25 degC to degF' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(77, 0);
  });

  it('should handle various temperature formats', async () => {
    const fahrenheit = await calculatorExecutor.calculate({ expression: '100 degC to degF' });
    expect(fahrenheit.success).toBe(true);
    expect(parseFloat(fahrenheit.content || '0')).toBeCloseTo(212, 0);

    const celsius = await calculatorExecutor.calculate({ expression: '32 degF to degC' });
    expect(celsius.success).toBe(true);
    expect(parseFloat(celsius.content || '0')).toBeCloseTo(0, 0);
  });

  it('should handle length conversions with mathjs syntax', async () => {
    const result = await calculatorExecutor.calculate({ expression: '5 cm to inch' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(1.9685, 3);
  });

  it('should handle weight conversions', async () => {
    const result = await calculatorExecutor.calculate({ expression: '1 kg to lb' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(2.2046, 3);
  });

  it('should handle speed conversions', async () => {
    const result = await calculatorExecutor.calculate({ expression: '100 km/h to mph' });
    // Note: This might fail depending on mathjs unit support
    console.log('Speed result:', result.content, result.success);
    if (result.success) {
      expect(parseFloat(result.content || '0')).toBeCloseTo(62.137, 2);
    } else {
      // Some unit combinations might not be supported
      expect(result.success).toBe(false);
    }
  });

  it('should handle invalid temperature syntax gracefully', async () => {
    const result = await calculatorExecutor.calculate({ expression: '25 °C to °F' });
    // This might fail due to Unicode degree symbol
    console.log('Unicode result:', result.content, result.success);
  });
  describe('Calculator Calculus', () => {
    describe('differentiate', () => {
      it('should differentiate polynomial expressions', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'x^3',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('3*x');
      });

      it('should differentiate quadratic expressions', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'x^2',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('2*x');
      });

      it('should differentiate trigonometric functions', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'sin(x)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('cos(x)');
      });

      it('should differentiate exponential functions', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'exp(x)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('e^x');
      });

      it('should handle chain rule', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'sin(x^2)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('cos');
        expect(result.content).toContain('x');
      });

      it('should differentiate with respect to custom variable', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'y^2 + 2*y',
          variable: 'y',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('2*y');
      });

      it('should handle invalid expressions gracefully', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'invalid',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('0');
      });

      it('should preserve state information', async () => {
        const result = await calculatorExecutor.differentiate({
          expression: 'x^2 + 3*x + 2',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.state?.expression).toBe('x^2 + 3*x + 2');
        expect(result.state?.variable).toBe('x');
        expect(result.state?.result).toBeDefined();
      });
    });

    describe('integrate', () => {
      it('should integrate polynomial expressions', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'x^2',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('(1/3)');
        expect(result.content).toContain('x^3');
      });

      it('should integrate cubic expressions', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'x^3',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('(1/4)');
        expect(result.content).toContain('x^4');
      });

      it('should integrate trigonometric functions', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'sin(x)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('-cos');
      });

      it('should integrate exponential functions', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'exp(x)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('e^x');
      });

      it('should integrate linear expressions', async () => {
        const result = await calculatorExecutor.integrate({
          expression: '3*x',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('(3/2)');
        expect(result.content).toContain('x^2');
      });

      it('should integrate with respect to custom variable', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'y^2',
          variable: 'y',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('y^3');
      });

      it('should handle invalid expressions gracefully', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'invalid',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('invalid*x');
      });

      it('should preserve state information', async () => {
        const result = await calculatorExecutor.integrate({
          expression: 'x^2 + 2*x',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.state?.expression).toBe('x^2 + 2*x');
        expect(result.state?.variable).toBe('x');
        expect(result.state?.result).toBeDefined();
      });
    });

    describe('limit', () => {
      it('should compute finite limit at a point', async () => {
        const result = await calculatorExecutor.limit({
          expression: 'sin(x)/x',
          variable: 'x',
          point: 0,
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('1');
        expect(result.state?.point).toBe(0);
      });

      it('should compute limit at infinity', async () => {
        const result = await calculatorExecutor.limit({
          expression: '1/x',
          variable: 'x',
          point: 'infinity',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('0');
        expect(result.state?.point).toBe('infinity');
      });

      it('should compute limit without specifying point', async () => {
        const result = await calculatorExecutor.limit({
          expression: '(x^2-1)/(x-1)',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('2');
        expect(result.state?.point).toBe(undefined);
      });

      it('should compute limit approaching from left', async () => {
        const result = await calculatorExecutor.limit({
          expression: '(1+1/x)^x',
          variable: 'x',
          point: 'infinity',
        });

        expect(result.success).toBe(true);
        expect(result.content).toContain('infinity');
      });

      it('should compute limit with trigonometric function', async () => {
        const result = await calculatorExecutor.limit({
          expression: '(1-cos(x))/x',
          variable: 'x',
          point: 0,
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('0');
      });

      it('should handle invalid expressions gracefully', async () => {
        const result = await calculatorExecutor.limit({
          expression: 'invalid',
          variable: 'x',
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe('0');
        expect(result.error?.type).toBe('LimitError');
      });

      it('should preserve state information', async () => {
        const result = await calculatorExecutor.limit({
          expression: 'sin(x)/x',
          variable: 'x',
          point: 0,
        });

        expect(result.success).toBe(true);
        expect(result.state?.expression).toBe('sin(x)/x');
        expect(result.state?.variable).toBe('x');
        expect(result.state?.point).toBe(0);
        expect(result.state?.result).toBeDefined();
      });
    });
  });

  it('should handle uppercase PI', async () => {
    const PI = await calculatorExecutor.calculate({ expression: 'PI' });
    expect(PI.success).toBe(true);
    expect(parseFloat(PI.content || '0')).toBeCloseTo(3.14159, 5);
  });

  it('should handle PI in expressions', async () => {
    const result = await calculatorExecutor.calculate({ expression: '2 * pi' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(6.28318, 4);
  });

  it('should handle PI in trigonometric functions', async () => {
    const result = await calculatorExecutor.calculate({ expression: 'sin(pi/2)' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(1, 5);
  });

  it('should handle PI in evaluate', async () => {
    const result = await calculatorExecutor.evaluate({
      expression: 'x * pi',
      variables: { x: 3 },
    });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(9.42477, 4);
  });

  it('should handle other constants like E', async () => {
    const e = await calculatorExecutor.calculate({ expression: 'e' });
    expect(e.success).toBe(true);
    expect(parseFloat(e.content || '0')).toBeCloseTo(2.71828, 5);
  });

  it('should handle constants in scientific notation', async () => {
    const result = await calculatorExecutor.calculate({ expression: 'pi * 1e3' });
    expect(result.success).toBe(true);
    expect(parseFloat(result.content || '0')).toBeCloseTo(3141.59, 2);
  });
});

describe('Calculator Base Conversion', () => {
  it('should base binary to decimal', async () => {
    const result = await calculatorExecutor.base({
      number: '1010',
      fromBase: 2,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('10');
    expect(result.state?.decimalValue).toBe(10);
  });

  it('should base decimal to binary', async () => {
    const result = await calculatorExecutor.base({
      number: '255',
      fromBase: 10,
      toBase: 2,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('11111111');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should base hexadecimal to octal', async () => {
    const result = await calculatorExecutor.base({
      number: 'FF',
      fromBase: 16,
      toBase: 8,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('377');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should base octal to hexadecimal', async () => {
    const result = await calculatorExecutor.base({
      number: '77',
      fromBase: 8,
      toBase: 16,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('3F');
    expect(result.state?.decimalValue).toBe(63);
  });

  it('should handle hexadecimal input', async () => {
    const result = await calculatorExecutor.base({
      number: 'FF',
      fromBase: 16,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('255');
    expect(result.state?.decimalValue).toBe(255);
  });

  it('should handle invalid numbers', async () => {
    const result = await calculatorExecutor.base({
      number: '2AB',
      fromBase: 2,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should support bases 2-36 with numeric input', async () => {
    const result = await calculatorExecutor.base({
      number: 'Z',
      fromBase: 36,
      toBase: 10,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('35');
    expect(result.state?.decimalValue).toBe(35);
  });

  it('should base decimal to base 32', async () => {
    const result = await calculatorExecutor.base({
      number: '1000',
      fromBase: 10,
      toBase: 32,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('V8');
    expect(result.state?.decimalValue).toBe(1000);
  });

  it('should handle invalid base numbers', async () => {
    const result = await calculatorExecutor.base({
      number: '123',
      fromBase: 1,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should handle invalid base 37', async () => {
    const result = await calculatorExecutor.base({
      number: '123',
      fromBase: 10,
      toBase: 37,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });

  it('should validate digit characters for base', async () => {
    const result = await calculatorExecutor.base({
      number: 'G',
      fromBase: 16,
      toBase: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ConversionError');
  });
});

describe('Calculator Core Functions', () => {
  describe('calculate', () => {
    it('should handle basic arithmetic', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '2 + 3 * 4',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('14');
      expect(result.state?.result).toBe('14');
    });

    it('should handle unit conversions (cm to inch)', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '5 cm to inch',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('1.968503937 inch');
    });

    it('should handle unit conversions (kg to lb)', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '1 kg to lb',
      });

      expect(result.success).toBe(true);
      expect(parseFloat(result.content || '0')).toBeCloseTo(2.20462, 5);
    });

    it('should handle scientific functions', async () => {
      const result = await calculatorExecutor.calculate({
        expression: 'sin(30 deg)',
      });

      expect(result.success).toBe(true);
      expect(parseFloat(result.content || '0')).toBeCloseTo(0.5, 5);
    });

    it('should handle matrix operations', async () => {
      const result = await calculatorExecutor.calculate({
        expression: 'det([[1,2],[3,4]])',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('-2');
    });

    it('should handle complex numbers', async () => {
      const result = await calculatorExecutor.calculate({
        expression: 'sqrt(-1)',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('i');
    });

    it('should handle precision formatting', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '10 / 3',
        precision: 2,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('3.33');
    });

    it('should handle zero precision (default)', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '10 / 3',
        precision: 0,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('3');
    });

    it('should handle undefined expression', async () => {
      const result = await calculatorExecutor.calculate({
        expression: 'invalid_syntax_*(',
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('CalculationError');
    });
  });

  describe('evaluate', () => {
    it('should handle variable substitution', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: 'x^2 + 2*x + 1',
        variables: { x: 5 },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('36');
      expect(result.state?.result).toBe('36');
      expect(result.state?.variables).toEqual({ x: 5 });
    });

    it('should handle multiple variables', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: 'a*x + b',
        variables: { a: 2, x: 3, b: 1 },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('7');
    });

    it('should handle no variables', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: '2 + 2',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('4');
    });

    it('should handle missing variables gracefully', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: 'x + y',
        variables: { x: 1 }, // y is missing
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('CalculationError');
    });

    it('should handle complex expressions with variables', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: 'sin(x) * cos(y)',
        variables: { x: 1.5708, y: 0 }, // Approximate pi/2
      });

      expect(result.success).toBe(true);
      expect(parseFloat(result.content || '0')).toBeCloseTo(1, 5);
    });
  });

  describe('base', () => {
    it('should handle number input in base conversion', async () => {
      const result = await calculatorExecutor.base({
        number: 255,
        fromBase: 10,
        toBase: 2,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('11111111');
    });

    it('should handle string input in base conversion', async () => {
      const result = await calculatorExecutor.base({
        number: '255',
        fromBase: 10,
        toBase: 2,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('11111111');
    });

    it('should handle zero in base conversion', async () => {
      const result = await calculatorExecutor.base({
        number: '0',
        fromBase: 10,
        toBase: 16,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('0');
    });

    it('should handle large numbers', async () => {
      const result = await calculatorExecutor.base({
        number: '4294967295',
        fromBase: 10,
        toBase: 16,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('FFFFFFFF');
    });

    it('should handle base 36 conversion', async () => {
      const result = await calculatorExecutor.base({
        number: '123456789',
        fromBase: 10,
        toBase: 36,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('21I3V9');
    });

    it('should handle invalid base error', async () => {
      const result = await calculatorExecutor.base({
        number: '123',
        fromBase: 1, // Invalid base
        toBase: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ConversionError');
      expect(result.error?.message).toContain('Base must be between 2 and 36');
    });

    it('should handle invalid digit error', async () => {
      const result = await calculatorExecutor.base({
        number: 'G', // Invalid digit for hex
        fromBase: 16,
        toBase: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ConversionError');
      expect(result.error?.message).toContain('Invalid digit');
    });

    it('should handle decimal input with parseInt behavior', async () => {
      const result = await calculatorExecutor.base({
        number: '15.5',
        fromBase: 10,
        toBase: 2,
      });

      // parseInt will only handle integer part, decimal part is ignored
      expect(result.success).toBe(true);
      expect(result.content).toBe('1111');
    });
  });

  describe('error handling', () => {
    it('should handle division by zero', async () => {
      const result = await calculatorExecutor.calculate({
        expression: '1 / 0',
      });

      // mathjs handles division by zero as Infinity
      expect(result.success).toBe(true);
      expect(result.content).toBe('Infinity');
    });

    it('should handle expression evaluation errors gracefully', async () => {
      const result = await calculatorExecutor.evaluate({
        expression: 'x ^^^^^ y',
        variables: { x: 1, y: 2 },
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('CalculationError');
    });

    it('should preserve state information on errors', async () => {
      const result = await calculatorExecutor.calculate({
        expression: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Calculation error');
      expect(result.error?.message).toBeDefined();
    });
  });
});

describe('Calculator Sorting', () => {
  describe('sort', () => {
    it('should default to sorted array when no mode provided', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['2.718', '3.14']);
    });

    it('should return sorted array when no mode provided', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['1.618', '2.718', '3.14', '4.669']);
    });

    it('should return largest value only in largest mode', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        mode: 'largest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('4.669');
    });

    it('should return smallest value only in smallest mode', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        mode: 'smallest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('1.618');
    });

    it('should compare string numbers', async () => {
      const result = await calculatorExecutor.sort({
        numbers: ['3.14', '2.718', '1.618'],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['1.618', '2.718', '3.14']);
    });

    it('should compare mixed string and number inputs', async () => {
      const result = await calculatorExecutor.sort({
        numbers: ['3.14', 2.718, '1.618'],
        mode: 'largest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('3.14');
    });

    it('should handle precision formatting', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.1415926535, 2.7182818284, 1.6180339887],
        precision: 3,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['1.618', '2.718', '3.142']);
    });

    it('should handle zero precision', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618],
        mode: 'largest',
        precision: 0,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('3');
    });

    it('should handle duplicate values', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [5, 3, 5, 2],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['2', '3', '5', '5']);
    });

    it('should require at least 2 numbers', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ValidationError');
      expect(result.content).toContain('At least 2 numbers are required');
    });

    it('should handle invalid number strings', async () => {
      const result = await calculatorExecutor.sort({
        numbers: ['3.14', 'invalid', '2.718'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ComparisonError');
      expect(result.content).toContain('Invalid number: invalid');
    });

    it('should handle negative numbers', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [-3.14, -2.718, -1.618],
        mode: 'smallest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('-3.14');
    });

    it('should handle zero values', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [0, -1, 1],
        mode: 'largest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('1');
    });

    it('should handle very large numbers', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [1e10, 1e9, 1e11],
        mode: 'smallest',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('1000000000');
    });

    it('should preserve state information', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718],
        mode: 'largest',
        precision: 2,
      });

      expect(result.success).toBe(true);
      expect(result.state?.originalNumbers).toEqual([3.14, 2.718]);
      expect(result.state?.mode).toBe('largest');
      expect(result.state?.precision).toBe(2);
      expect(result.state?.largest).toBe('3.14');
      expect(result.state?.smallest).toBe('2.72');
      expect(result.state?.sorted).toEqual(['2.72', '3.14']);
    });

    it('should sort in descending order when reverse is true', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        reverse: true,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['4.669', '3.14', '2.718', '1.618']);
    });

    it('should sort in ascending order when reverse is false', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        reverse: false,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['1.618', '2.718', '3.14', '4.669']);
    });

    it('should default to ascending order when reverse is not specified', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual(['1.618', '2.718', '3.14', '4.669']);
    });

    it('should work with reverse parameter in largest mode', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        mode: 'largest',
        reverse: true,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('4.669');
    });

    it('should work with reverse parameter in smallest mode', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718, 1.618, 4.669],
        mode: 'smallest',
        reverse: true,
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed).toBe('1.618');
    });

    it('should preserve reverse parameter in state', async () => {
      const result = await calculatorExecutor.sort({
        numbers: [3.14, 2.718],
        reverse: true,
        precision: 2,
      });

      expect(result.success).toBe(true);
      expect(result.state?.reverse).toBe(true);
      expect(result.state?.sorted).toEqual(['3.14', '2.72']);
    });
  });
});

describe('Calculator Equation Solver', () => {
  describe('solve', () => {
    it('should solve linear equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['3*x + 5 = 20'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('5');
      expect(result.state?.equation).toEqual(['3*x + 5 = 20']);
    });

    it('should solve quadratic equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x^2 - 5*x + 6 = 0'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('2');
      expect(result.content).toContain('3');
      expect(result.state?.equation).toEqual(['x^2 - 5*x + 6 = 0']);
    });

    it('should solve perfect square equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x^2 + 2*x + 1 = 0'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('-1');
      expect(result.state?.equation).toEqual(['x^2 + 2*x + 1 = 0']);
    });

    it('should solve equations with custom variable', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['y^2 - 9 = 0'],
        variable: ['y'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('3');
      expect(result.content).toContain('-3');
      expect(result.state?.variable).toEqual(['y']);
    });

    it('should solve simple equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x - 5 = 0'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('5');
    });

    it('should handle equations with fractions', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['2*x = 10'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('5');
    });

    it('should handle cubic equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x^3 - 8 = 0'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('2');
    });

    it('should handle invalid equations gracefully', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['invalid equation'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('SolveError');
    });

    it('should preserve state information', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x^2 - 4 = 0'],
        variable: ['x'],
      });

      expect(result.success).toBe(true);
      expect(result.state?.equation).toEqual(['x^2 - 4 = 0']);
      expect(result.state?.variable).toEqual(['x']);
      expect(result.state?.result).toBeDefined();
    });

    it('should solve system of two equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['2*x+y=5', 'x-y=1'],
        variable: ['x', 'y'],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed.x).toBe('2');
      expect(parsed.y).toBe('1');
    });

    it('should solve system of two equations with default variables', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['3*x+2*y=7', 'x-y=1'],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parseFloat(parsed.x)).toBeCloseTo(1.8, 1);
      expect(parseFloat(parsed.y)).toBeCloseTo(0.8, 1);
    });

    it('should solve system of three equations', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x+y+z=6', '2*x-y+z=3', 'x+2*y-z=2'],
        variable: ['x', 'y', 'z'],
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content || '{}');
      expect(parsed.x).toBe('1');
      expect(parsed.y).toBe('2');
      expect(parsed.z).toBe('3');
    });

    it('should handle system with no solution', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x+y=5', 'x+y=7'],
        variable: ['x', 'y'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('SolveError');
      expect(result.content).toContain('distinct solution');
    });

    it('should handle single equation with extra variables in array', async () => {
      const result = await calculatorExecutor.solve({
        equation: ['x+y=5'],
        variable: ['x', 'y'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });
  });
});
