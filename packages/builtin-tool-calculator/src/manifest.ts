import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CalculatorApiName, CalculatorIdentifier } from './types';

export const CalculatorManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'Calculate the result of a mathematical expression.',
      name: CalculatorApiName.calculate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to calculate (e.g., "2 + 3 * 4", "sqrt(16)", "sin(30 deg)", "det([[1,2],[3,4]])", "5 cm to inch")',
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
      description: 'Evaluate a complex mathematical expression with variable support.',
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
        'Sort multiple numbers with flexible output options (sorted array, largest value, or smallest value).',
      name: CalculatorApiName.sort,
      parameters: {
        additionalProperties: false,
        properties: {
          mode: {
            description:
              'Optional mode: "largest" returns only largest value; "smallest" returns only smallest value; if not specified, returns sorted array',
            enum: ['largest', 'smallest'],
            type: 'string',
          },
          numbers: {
            description:
              'Array of numbers to compare (e.g., ["3.14", "2.718", "1.618"] or [3.14, 2.718, 1.618])',
            items: {
              type: ['string', 'number'],
            },
            minItems: 2,
            type: 'array',
          },
          precision: {
            description:
              'Number of decimal places for comparison results (optional, defaults to 10)',
            maximum: 20,
            minimum: 0,
            type: 'number',
          },
        },
        required: ['numbers'],
        type: 'object',
      },
    },
    {
      description: 'Convert numbers between different number bases.',
      name: CalculatorApiName.convertBase,
      parameters: {
        additionalProperties: false,
        properties: {
          fromBase: {
            description: 'Source base of the input number (numeric value between 2-36)',
            maximum: 36,
            minimum: 2,
            type: 'number',
          },
          number: {
            description:
              'The number to convert (string or number, e.g., "1010", 1010, "77", "255", "FF", "Z")',
            type: ['string', 'number'],
          },
          toBase: {
            description: 'Target base for conversion (numeric value between 2-36)',
            maximum: 36,
            minimum: 2,
            type: 'number',
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
