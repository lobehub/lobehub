import { BaseExecutor, type BuiltinToolResult, type IBuiltinToolExecutor } from '@lobechat/types';
import { defBase } from '@thi.ng/base-n/base';
import { all, create } from 'mathjs';
// @ts-ignore - nerdamer doesn't have TypeScript definitions
import nerdamer from 'nerdamer/all';

import {
  type BaseParams,
  type CalculateParams,
  CalculatorApiName,
  CalculatorIdentifier,
  type DifferentiateParams,
  type EvaluateParams,
  type IntegrateParams,
  type LimitParams,
  type SolveParams,
  type SortParams,
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
   * Convert number between bases using @thi.ng/base-n
   */
  private convertNumber(number: string | number, fromBase: number, toBase: number): string {
    // Define character set for source and target bases
    const sourceChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, fromBase);
    const targetChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, toBase);

    // Create converters
    const sourceConverter = defBase(sourceChars);
    const targetConverter = defBase(targetChars);

    // Convert input number to string
    let numStr = String(number).trim().toUpperCase();

    // Handle decimal input like parseInt - take only integer part
    const decimalIndex = numStr.indexOf('.');
    if (decimalIndex !== -1) {
      numStr = numStr.slice(0, Math.max(0, decimalIndex));
    }

    // Convert from source base to decimal (as bigint)
    const decimal = sourceConverter.decodeBigInt(numStr);

    // Convert decimal to target base
    return targetConverter.encodeBigInt(decimal);
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
  evaluate = async (params: EvaluateParams): Promise<BuiltinToolResult> => {
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
   * Sort multiple numbers with flexible output options
   */
  sort = async (params: SortParams): Promise<BuiltinToolResult> => {
    try {
      const { numbers, mode, precision, reverse } = params;

      if (numbers.length < 2) {
        return {
          content: 'At least 2 numbers are required for comparison',
          error: {
            message: 'Insufficient numbers for comparison',
            type: 'ValidationError',
          },
          success: false,
        };
      }

      // Convert all numbers to actual numbers for comparison
      const parsedNumbers = numbers.map((num) => {
        const parsed = typeof num === 'string' ? parseFloat(num) : num;
        if (isNaN(parsed)) {
          throw new Error(`Invalid number: ${num}`);
        }
        return parsed;
      });

      // Sort numbers (ascending by default, reverse if specified)
      const sortedParsed = [...parsedNumbers].sort((a, b) => (reverse ? b - a : a - b));

      // Format numbers for output
      const formatNumber = (num: number): string => {
        if (precision !== undefined) {
          return num.toFixed(precision);
        }
        return num.toString();
      };

      const sorted = sortedParsed.map(formatNumber);
      const largest = formatNumber(Math.max(...parsedNumbers));
      const smallest = formatNumber(Math.min(...parsedNumbers));

      let result: any;

      switch (mode) {
        case 'largest': {
          result = largest;
          break;
        }
        case 'smallest': {
          result = smallest;
          break;
        }
        default: {
          result = sorted;
        }
      }

      return {
        content: JSON.stringify(result),
        state: {
          largest,
          mode,
          originalNumbers: numbers,
          precision,
          result,
          reverse,
          smallest,
          sorted,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Comparison error: ${err.message}`,
        error: {
          message: err.message,
          type: 'ComparisonError',
        },
        success: false,
      };
    }
  };

  /**
   * Convert numbers between different bases (supports bases 2-36)
   */
  base = async (params: BaseParams): Promise<BuiltinToolResult> => {
    try {
      const { number, fromBase, toBase } = params;

      // Validate base range
      if (fromBase < 2 || fromBase > 36 || toBase < 2 || toBase > 36) {
        throw new Error('Base must be between 2 and 36');
      }

      // Convert using @thi.ng/base-n
      const convertedNumber = this.convertNumber(number, fromBase, toBase);

      // Get decimal value for state
      const decimalValue = parseInt(String(number), fromBase);

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

      // Check for digit validation error
      let errorMessage = err.message;
      if (err.message?.includes('Cannot convert') || err.message?.includes('Invalid digit')) {
        errorMessage = 'Invalid digit';
      }

      return {
        content: `Base conversion error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: 'ConversionError',
        },
        success: false,
      };
    }
  };

  /**
   * Solve equation or system of equations using nerdamer
   */
  solve = async (params: SolveParams): Promise<BuiltinToolResult> => {
    try {
      const { equation, variable } = params;

      let resultText: string;

      if (equation.length === 1) {
        const solveVariable = variable && variable.length > 0 ? variable[0] : 'x';
        const result = nerdamer.solve(equation[0], solveVariable);
        const rawResult = result.toString();

        if (rawResult === '[]') {
          return {
            content: 'No solution found for the given equation',
            error: {
              message: 'No solution found',
              type: 'SolveError',
            },
            success: false,
          };
        }
        resultText = rawResult;
      } else {
        let solveVariables: string[];

        if (variable && variable.length > 0) {
          solveVariables = variable;
        } else {
          const allVars = new Set<string>();
          for (const eq of equation) {
            const nerdamerEq = nerdamer(eq);
            const vars = nerdamerEq.variables() as string[];
            for (const v of vars) {
              if (v !== '') {
                allVars.add(v);
              }
            }
          }
          solveVariables = Array.from(allVars);
          if (solveVariables.length === 0) {
            solveVariables = ['x'];
          }
        }

        const result = nerdamer.solveEquations(equation, solveVariables);
        const rawResult = result.toString();

        const pairs = rawResult.split(',');
        const solution: Record<string, string> = {};
        for (let i = 0; i < pairs.length; i += 2) {
          if (i + 1 < pairs.length) {
            solution[pairs[i]] = pairs[i + 1];
          }
        }
        resultText = JSON.stringify(solution, null, 2);
      }

      return {
        content: resultText,
        state: {
          equation,
          result: resultText,
          variable,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Equation solver error: ${err.message}`,
        error: {
          message: err.message,
          type: 'SolveError',
        },
        success: false,
      };
    }
  };

  /**
   * Differentiate an expression using nerdamer
   */
  differentiate = async (params: DifferentiateParams): Promise<BuiltinToolResult> => {
    try {
      const { expression, variable } = params;
      const result = nerdamer(`diff(${expression}, ${variable})`);
      const resultText = result.toString();

      return {
        content: resultText,
        state: {
          expression,
          result: resultText,
          variable,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Differentiation error: ${err.message}`,
        error: {
          message: err.message,
          type: 'DifferentiationError',
        },
        success: false,
      };
    }
  };

  /**
   * Integrate an expression using nerdamer
   */
  integrate = async (params: IntegrateParams): Promise<BuiltinToolResult> => {
    try {
      const { expression, variable } = params;
      const result = nerdamer(`integrate(${expression}, ${variable})`);
      const resultText = result.toString();

      return {
        content: resultText,
        state: {
          expression,
          result: resultText,
          variable,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Integration error: ${err.message}`,
        error: {
          message: err.message,
          type: 'IntegrationError',
        },
        success: false,
      };
    }
  };

  /**
   * Compute the limit of a mathematical expression using nerdamer
   */
  limit = async (params: LimitParams): Promise<BuiltinToolResult> => {
    try {
      const { expression, variable, point } = params;
      let limitExpr: string;

      if (point !== undefined) {
        limitExpr = `limit(${expression}, ${variable}, ${point})`;
      } else {
        limitExpr = `limit(${expression}, ${variable})`;
      }

      const result = nerdamer(limitExpr);
      const resultText = result.toString();

      return {
        content: resultText,
        state: {
          expression,
          point,
          result: resultText,
          variable,
        },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Limit computation error: ${err.message}`,
        error: {
          message: err.message,
          type: 'LimitError',
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
