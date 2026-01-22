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
   * Convert number to target base with clean formatting
   */
  private convertToBase(decimalValue: number, targetBase: number): string {
    return decimalValue.toString(targetBase).toUpperCase();
  }

  /**
   * Clean and validate input number
   */
  private cleanInputNumber(number: string | number, sourceBase: number): string {
    const trimmed = String(number).trim();

    // Validate base range
    if (sourceBase < 2 || sourceBase > 36) {
      throw new Error(`Base must be between 2 and 36, got ${sourceBase}`);
    }

    // Validate that the number contains only valid characters for the base
    const validChars = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, sourceBase));
    for (const char of trimmed.toUpperCase()) {
      if (!validChars.has(char)) {
        throw new Error(`Invalid digit '${char}' for base ${sourceBase}`);
      }
    }

    return trimmed;
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
        content: formattedResult,
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

      return {
        content: formattedResult,
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
   * Convert numbers between different bases (supports bases 2-36)
   */
  convertBase = async (params: ConvertBaseParams): Promise<BuiltinToolResult> => {
    try {
      const { number, fromBase, toBase } = params;

      // Clean and validate input number
      const cleanNumber = this.cleanInputNumber(number, fromBase);

      // Convert to decimal first using optimized parseInt
      const decimalValue = parseInt(cleanNumber, fromBase);
      if (isNaN(decimalValue)) {
        throw new Error(`Invalid number "${number}" for base ${fromBase}`);
      }

      // Convert to target base
      const convertedNumber = this.convertToBase(decimalValue, toBase);

      return {
        content: convertedNumber,
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
