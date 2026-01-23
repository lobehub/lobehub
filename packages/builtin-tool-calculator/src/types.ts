export const CalculatorIdentifier = 'lobe-calculator';

export const CalculatorApiName = {
  base: 'base',
  calculate: 'calculate',
  differentiate: 'differentiate',
  evaluate: 'evaluate',
  integrate: 'integrate',
  limit: 'limit',
  solve: 'solve',
  sort: 'sort',
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

// Evaluate API (for more complex mathematical expressions with variables)
export interface EvaluateParams {
  expression: string;
  precision?: number;
  variables?: Record<string, number>;
}

export interface EvaluateState {
  expression?: string;
  precision?: number;
  result?: number | string;
  variables?: Record<string, number>;
}

// Base Conversion API
export interface BaseParams {
  fromBase: number;
  number: string | number;
  toBase: number;
}

export interface BaseState {
  convertedNumber?: string;
  decimalValue?: number;
  originalBase?: string;
  originalNumber?: string;
  targetBase?: string;
}

// Sort API
export interface SortParams {
  mode?: 'largest' | 'smallest';
  numbers: (string | number)[];
  precision?: number;
  reverse?: boolean;
}

export interface SortState {
  // Can be array, string, or object based on mode
  largest?: number | string;
  mode?: string;
  originalNumbers?: (string | number)[];
  precision?: number;
  result?: any;
  smallest?: number | string;
  sorted?: (string | number)[];
}

// Nerdamer Equation Solver API
export interface SolveParams {
  equation: string[];
  variable?: string[];
}

export interface SolveState {
  equation?: string[];
  result?: string | string[];
  variable?: string[];
}

// Nerdamer Differentiate API
export interface DifferentiateParams {
  expression: string;
  variable: string;
}

export interface DifferentiateState {
  expression?: string;
  result?: string;
  variable?: string;
}

// Nerdamer Integrate API
export interface IntegrateParams {
  expression: string;
  variable: string;
}

export interface IntegrateState {
  expression?: string;
  result?: string;
  variable?: string;
}

// Nerdamer Limit API
export interface LimitParams {
  expression: string;
  point?: string | number;
  variable: string;
}

export interface LimitState {
  expression?: string;
  point?: string | number;
  result?: string;
  variable?: string;
}
