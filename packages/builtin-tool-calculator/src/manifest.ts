import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CalculatorApiName, CalculatorIdentifier } from './types';

export const CalculatorManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'Calculate result of a mathematical expression.',
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
            description: 'Number of decimal places for result (optional, defaults to 10)',
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
      name: CalculatorApiName.evaluate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to evaluate (e.g., "x^2 + 2*x + 1", "det([[a,b],[c,d]])", "sqrt(a^2 + b^2)")',
            type: 'string',
          },
          precision: {
            description: 'Number of decimal places for result (optional, defaults to 10)',
            maximum: 20,
            minimum: 0,
            type: 'number',
          },
          variables: {
            description:
              'Key-value pairs of variables to substitute in expression (e.g., {"x": 5, "r": 3})',
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
          reverse: {
            description:
              'Sort order: false (default) sorts ascending (smallest to largest); true sorts descending (largest to smallest)',
            type: 'boolean',
          },
        },
        required: ['numbers'],
        type: 'object',
      },
    },
    {
      description: 'Convert numbers between different number bases.',
      name: CalculatorApiName.base,
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
    {
      description: 'Differentiate a mathematical expression with respect to a variable.',
      name: CalculatorApiName.differentiate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to differentiate (e.g., "x^2", "sin(x)", "x^3 + 2*x + 1")',
            type: 'string',
          },
          variable: {
            description: 'Variable to differentiate with respect to (e.g., "x", "y", "t")',
            type: 'string',
          },
        },
        required: ['expression', 'variable'],
        type: 'object',
      },
    },
    {
      description:
        'Compute definite integral of a mathematical expression with respect to a variable over a given interval.',
      name: CalculatorApiName.defintegrate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description: 'Mathematical expression to integrate (e.g., "x^2", "sin(x)", "exp(x)")',
            type: 'string',
          },
          lowerBound: {
            description: 'Lower bound of integration (can be number, "0", "-infinity", etc.)',
            type: 'number | string',
          },
          upperBound: {
            description: 'Upper bound of integration (can be number, "pi", "infinity", etc.)',
            type: 'number | string',
          },
          variable: {
            description: 'Variable to integrate with respect to (e.g., "x", "y", "t")',
            type: 'string',
          },
        },
        required: ['expression', 'variable', 'lowerBound', 'upperBound'],
        type: 'object',
      },
    },
    {
      description:
        'Integrate a mathematical expression with respect to a variable (indefinite integral).',
      name: CalculatorApiName.integrate,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description: 'Mathematical expression to integrate (e.g., "x^2", "sin(x)", "exp(x)")',
            type: 'string',
          },
          variable: {
            description: 'Variable to integrate with respect to (e.g., "x", "y", "t")',
            type: 'string',
          },
        },
        required: ['expression', 'variable'],
        type: 'object',
      },
    },
    {
      description: 'Compute the limit of a mathematical expression.',
      name: CalculatorApiName.limit,
      parameters: {
        additionalProperties: false,
        properties: {
          expression: {
            description:
              'Mathematical expression to compute limit for (e.g., "sin(x)/x", "x^2", "exp(-x)")',
            type: 'string',
          },
          point: {
            description:
              'Point at which to evaluate the limit (optional). If not specified, computes the limit as variable approaches the expression. Can be a specific value or "infinity" (e.g., "0", "1", "infinity")',
            oneOf: [{ type: 'string' }, { type: 'number' }],
          },
          variable: {
            description: 'Variable to compute limit with respect to (e.g., "x", "y", "t")',
            type: 'string',
          },
        },
        required: ['expression', 'variable'],
        type: 'object',
      },
    },
    {
      description: 'Solve algebraic equations or systems of equations symbolically.',
      name: CalculatorApiName.solve,
      parameters: {
        additionalProperties: false,
        properties: {
          equation: {
            description:
              'The equation(s) to solve. Single equation (e.g., ["x^2 + 2*x + 1 = 0"]) or system of equations (e.g., ["2*x+y=5", "x-y=1"])',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          variable: {
            description:
              'Variable(s) to solve for. For single equation: array with one variable (optional, defaults to ["x"], e.g., ["x"]). For system of equations: array of variables (e.g., ["x", "y"])',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['equation'],
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
