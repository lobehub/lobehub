import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import { calculatorExecutor } from '../executor';
import {
  type BaseParams,
  type BaseState,
  type CalculateParams,
  type CalculateState,
  type DefintegrateParams,
  type DefintegrateState,
  type DifferentiateParams,
  type DifferentiateState,
  type EvaluateParams,
  type EvaluateState,
  type ExecuteParams,
  type ExecuteState,
  type IntegrateParams,
  type IntegrateState,
  type LimitParams,
  type LimitState,
  type SolveParams,
  type SolveState,
  type SortParams,
  type SortState,
} from '../types';

/**
 * Calculator Execution Runtime
 *
 * This runtime executes calculator tools using the same executor logic as frontend.
 * Since mathjs and nerdamer work in both browser and Node.js, we can reuse the executor.
 */
export class CalculatorExecutionRuntime {
  async calculate(args: CalculateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.calculate(args);

      const state: CalculateState = {
        expression: result.state?.expression,
        precision: result.state?.precision,
        result: result.state?.result as number | string | undefined,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async evaluate(args: EvaluateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.evaluate(args);

      const state: EvaluateState = {
        expression: result.state?.expression,
        precision: result.state?.precision,
        result: result.state?.result as number | string | undefined,
        variables: result.state?.variables,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async sort(args: SortParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.sort(args);

      const state: SortState = {
        largest: result.state?.largest as number | string | undefined,
        mode: result.state?.mode,
        originalNumbers: result.state?.originalNumbers,
        precision: result.state?.precision,
        result: result.state?.result,
        reverse: result.state?.reverse,
        smallest: result.state?.smallest as number | string | undefined,
        sorted: result.state?.sorted as (string | number)[] | undefined,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async base(args: BaseParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.base(args);

      const state: BaseState = {
        convertedNumber: result.state?.convertedNumber,
        decimalValue: result.state?.decimalValue,
        originalBase: result.state?.originalBase as string | undefined,
        originalNumber: result.state?.originalNumber as string | undefined,
        targetBase: result.state?.targetBase as string | undefined,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async solve(args: SolveParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.solve(args);

      const state: SolveState = {
        equation: result.state?.equation,
        result: result.state?.result as string | string[] | undefined,
        variable: result.state?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async differentiate(args: DifferentiateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.differentiate(args);

      const state: DifferentiateState = {
        expression: result.state?.expression,
        result: result.state?.result as string | undefined,
        variable: result.state?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async execute(args: ExecuteParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.execute(args);

      const state: ExecuteState = {
        expression: result.state?.expression,
        result: result.state?.result as string | undefined,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async defintegrate(args: DefintegrateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.defintegrate(args);

      const state: DefintegrateState = {
        expression: result.state?.expression,
        lowerBound: result.state?.lowerBound,
        result: result.state?.result as string | undefined,
        upperBound: result.state?.upperBound,
        variable: result.state?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async integrate(args: IntegrateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.integrate(args);

      const state: IntegrateState = {
        expression: result.state?.expression,
        result: result.state?.result as string | undefined,
        variable: result.state?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async limit(args: LimitParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.limit(args);

      const state: LimitState = {
        expression: result.state?.expression,
        point: result.state?.point,
        result: result.state?.result as string | undefined,
        variable: result.state?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }
}
