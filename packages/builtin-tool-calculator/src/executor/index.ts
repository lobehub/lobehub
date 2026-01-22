import { BaseExecutor, type BuiltinToolResult, type IBuiltinToolExecutor } from '@lobechat/types';
import { all, create } from 'mathjs';

import {
  type CalculateParams,
  CalculatorApiName,
  CalculatorIdentifier,
  type ConvertBaseParams,
  type EvaluateExpressionParams,
} from '../types';

// Create a mathjs instance with all functions
const math = create(all);

/**
 * Calculator Tool Executor
 *
 * Handles mathematical calculations and expression evaluations using mathjs library.
 */
class CalculatorExecutor
  extends BaseExecutor<typeof CalculatorApiName>
  implements IBuiltinToolExecutor
{
  readonly identifier = CalculatorIdentifier;
  protected readonly apiEnum = CalculatorApiName;

  /**
   * Safely evaluate a mathematical expression using mathjs
   */
  private evaluateMathExpression(expression: string, variables: Record<string, number> = {}): any {
    try {
      // Parse the expression with mathjs
      const node = math.parse(expression);

      // Compile and evaluate with variables
      const compiled = node.compile();
      const result = compiled.evaluate(variables);

      return result;
    } catch (error) {
      throw new Error(
        `Failed to evaluate expression: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Format result based on type and precision
   */
  private formatResult(result: any, precision?: number): string {
    if (typeof result === 'number') {
      if (precision !== undefined) {
        return result.toFixed(precision);
      }
      return result.toString();
    }

    if (typeof result === 'bigint') {
      return result.toString();
    }

    if (typeof result === 'string') {
      return result;
    }

    // Handle complex numbers, matrices, etc.
    return math.format(result, { precision: precision || 10 });
  }

  /**
   * Format expression with variables for display
   */
  private formatExpression(expression: string, variables: Record<string, number>): string {
    if (Object.keys(variables).length === 0) {
      return expression;
    }

    const varStr = Object.entries(variables)
      .map(([key, value]) => `${key} = ${value}`)
      .join(', ');
    return `${expression} (where ${varStr})`;
  }

  /**
   * Convert number to target base with proper formatting
   */
  private convertToBase(decimalValue: number, targetBase: string): string {
    switch (targetBase) {
      case 'binary': {
        return `0b${decimalValue.toString(2)}`;
      }
      case 'octal': {
        return `0o${decimalValue.toString(8)}`;
      }
      case 'hexadecimal': {
        return `0x${decimalValue.toString(16).toUpperCase()}`;
      }
      default: {
        return decimalValue.toString(10);
      }
    }
  }

  /**
   * Calculate a mathematical expression
   */
  calculate = async (params: CalculateParams): Promise<BuiltinToolResult> => {
    try {
      const result = this.evaluateMathExpression(params.expression);

      if (result === undefined) {
        return {
          content: `Cannot evaluate expression: "${params.expression}"`,
          error: {
            message: 'Expression resulted in undefined',
            type: 'ValidationError',
          },
          success: false,
        };
      }

      const formattedResult = this.formatResult(result, params.precision);

      return {
        content: `${params.expression} = ${formattedResult}`,
        state: {
          expression: params.expression,
          precision: params.precision,
          result: formattedResult,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Calculation error: ${err.message}`,
        error: {
          message: err.message,
          type: 'CalculationError',
        },
        success: false,
      };
    }
  };

  /**
   * Evaluate a complex mathematical expression with variables
   */
  evaluateExpression = async (params: EvaluateExpressionParams): Promise<BuiltinToolResult> => {
    try {
      const variables = params.variables || {};
      const result = this.evaluateMathExpression(params.expression, variables);

      if (result === undefined) {
        return {
          content: `Cannot evaluate expression: "${params.expression}"`,
          error: {
            message: 'Expression resulted in undefined',
            type: 'ValidationError',
          },
          success: false,
        };
      }

      const formattedResult = this.formatResult(result, params.precision);
      const expressionDisplay = this.formatExpression(params.expression, variables);

      return {
        content: `${expressionDisplay} = ${formattedResult}`,
        state: {
          expression: params.expression,
          precision: params.precision,
          result: formattedResult,
          variables,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Expression evaluation error: ${err.message}`,
        error: {
          message: err.message,
          type: 'CalculationError',
        },
        success: false,
      };
    }
  };

  /**
   * Convert numbers between different bases
   */
  convertBase = async (params: ConvertBaseParams): Promise<BuiltinToolResult> => {
    try {
      const { number, fromBase, toBase } = params;

      // Base mapping
      const baseMap = { binary: 2, decimal: 10, hexadecimal: 16, octal: 8 };
      const sourceBase = baseMap[fromBase];

      // Clean the number (remove prefixes if present)
      const trimmed = number.trim().toLowerCase();
      let cleanNumber: string;
      if (trimmed.startsWith('0b')) {
        cleanNumber = trimmed.slice(2);
      } else if (trimmed.startsWith('0o')) {
        cleanNumber = trimmed.slice(2);
      } else if (trimmed.startsWith('0x')) {
        cleanNumber = trimmed.slice(2);
      } else {
        cleanNumber = trimmed;
      }

      // Convert to decimal first
      let decimalValue: number;
      try {
        decimalValue = parseInt(cleanNumber, sourceBase);
        if (isNaN(decimalValue)) {
          throw new Error(`Invalid number "${number}" for base ${sourceBase}`);
        }
      } catch {
        return {
          content: `Invalid number format: "${number}" is not a valid ${fromBase} number`,
          error: {
            message: `Failed to parse "${number}" as ${fromBase}`,
            type: 'ValidationError',
          },
          success: false,
        };
      }

      // Convert to target base
      const convertedNumber = this.convertToBase(decimalValue, toBase);

      return {
        content: `${number} (${fromBase}) = ${convertedNumber} (${toBase})`,
        state: {
          convertedNumber,
          decimalValue,
          originalBase: fromBase,
          originalNumber: number,
          targetBase: toBase,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Base conversion error: ${err.message}`,
        error: {
          message: err.message,
          type: 'ConversionError',
        },
        success: false,
      };
    }
  };

  // Implement required interface methods
  getApiNames(): string[] {
    return Object.values(this.apiEnum) as string[];
  }

  hasApi(apiName: string): boolean {
    return (Object.values(this.apiEnum) as string[]).includes(apiName);
  }
}

// Export the executor instance for registration
export const calculatorExecutor = new CalculatorExecutor();
