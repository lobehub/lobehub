export const CalculatorIdentifier = 'lobe-calculator';

export const CalculatorApiName = {
  calculate: 'calculate',
  compare: 'compare',
  convertBase: 'convertBase',
  evaluateExpression: 'evaluateExpression',
} as const;

export type CalculatorApiNameType = (typeof CalculatorApiName)[keyof typeof CalculatorApiName];

// Calculate API
export interface CalculateParams {
  expression: string;
  precision?: number;
}

export interface CalculateState {
  expression?: string;
  precision?: number;
  result?: number | string;
}

// Evaluate Expression API (for more complex mathematical expressions)
export interface EvaluateExpressionParams {
  expression: string;
  precision?: number;
  variables?: Record<string, number>;
}

export interface EvaluateExpressionState {
  expression?: string;
  precision?: number;
  result?: number | string;
  variables?: Record<string, number>;
}

// Base Conversion API
export interface ConvertBaseParams {
  fromBase: number;
  number: string | number;
  toBase: number;
}

export interface ConvertBaseState {
  convertedNumber?: string;
  decimalValue?: number;
  originalBase?: string;
  originalNumber?: string;
  targetBase?: string;
}

// Compare API
export interface CompareParams {
  mode?: 'largest' | 'smallest';
  numbers: (string | number)[];
  precision?: number;
}

export interface CompareState {
  // Can be array, string, or object based on mode
  largest?: number | string;
  mode?: string;
  originalNumbers?: (string | number)[];
  precision?: number;
  result?: any;
  smallest?: number | string;
  sorted?: (string | number)[];
}
