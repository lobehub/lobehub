export const CalculatorIdentifier = 'lobe-calculator';

export const CalculatorApiName = {
  calculate: 'calculate',
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
  fromBase: 'binary' | 'octal' | 'decimal' | 'hexadecimal';
  number: string;
  toBase: 'binary' | 'octal' | 'decimal' | 'hexadecimal';
}

export interface ConvertBaseState {
  convertedNumber?: string;
  decimalValue?: number;
  originalBase?: string;
  originalNumber?: string;
  targetBase?: string;
}
