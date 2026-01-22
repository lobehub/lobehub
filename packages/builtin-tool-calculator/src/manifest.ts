import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CalculatorApiName } from './types';

export const CalculatorIdentifier = 'lobe-calculator';

export const CalculatorManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Calculate the result of a mathematical expression. Powered by mathjs library supporting comprehensive math functions, matrices, complex numbers, units, and symbolic calculations.',
      name: CalculatorApiName.calculate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to calculate (e.g., "2 + 3 * 4", "sqrt(16)", "sin(30°)", "det([[1,2],[3,4]])", "5 cm to inch")',
            type: 'string',
          },
          precision: {
            description: 'Number of decimal places for the result (optional, defaults to 10)',
            maximum: 20,
            minimum: 0,
            type: 'number',
          },
        },
        required: ['expression'],
        type: 'object',
      },
    },
    {
      description:
        'Evaluate a complex mathematical expression with variable support. Powered by mathjs supporting algebraic expressions, symbolic calculations, matrices, and advanced mathematical operations.',
      name: CalculatorApiName.evaluateExpression,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to evaluate (e.g., "x^2 + 2*x + 1", "det([[a,b],[c,d]])", "sqrt(a^2 + b^2)")',
            type: 'string',
          },
          precision: {
            description: 'Number of decimal places for the result (optional, defaults to 10)',
            maximum: 20,
            minimum: 0,
            type: 'number',
          },
          variables: {
            description:
              'Key-value pairs of variables to substitute in the expression (e.g., {"x": 5, "r": 3})',
            type: 'object',
          },
        },
        required: ['expression'],
        type: 'object',
      },
    },
    {
      description:
        'Convert numbers between different number bases (binary, octal, decimal, hexadecimal). Input number format should match the specified source base.',
      name: CalculatorApiName.convertBase,
      parameters: {
        additionalProperties: false,
        properties: {
          fromBase: {
            description: 'Source base of the input number',
            enum: ['binary', 'octal', 'decimal', 'hexadecimal'],
            type: 'string',
          },
          number: {
            description:
              'The number to convert (e.g., "1010" for binary, "77" for octal, "255" for decimal, "FF" for hexadecimal)',
            type: 'string',
          },
          toBase: {
            description: 'Target base for conversion',
            enum: ['binary', 'octal', 'decimal', 'hexadecimal'],
            type: 'string',
          },
        },
        required: ['number', 'fromBase', 'toBase'],
        type: 'object',
      },
    },
  ],
  identifier: CalculatorIdentifier,
  meta: {
    avatar: '🧮',
    title: 'Calculator',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
