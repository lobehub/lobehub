import { ModelUsage } from '@lobechat/types';

import { Cost, Usage } from '../types/usage';

/**
 * UsageCounter - Pure accumulator for usage and cost tracking
 * Focuses only on usage/cost calculations without managing state
 */
/* eslint-disable unicorn/no-static-only-class */
export class UsageCounter {
  /**
   * Create default usage statistics
   */
  private static createDefaultUsage(): Usage {
    return {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: {
        apiCalls: 0,
        processingTimeMs: 0,
        tokens: {
          input: 0,
          output: 0,
          total: 0,
        },
      },
      tools: {
        byTool: [],
        totalCalls: 0,
        totalTimeMs: 0,
      },
    };
  }

  /**
   * Create default cost statistics
   */
  private static createDefaultCost(): Cost {
    return {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: {
        byModel: [],
        currency: 'USD',
        total: 0,
      },
      tools: {
        byTool: [],
        currency: 'USD',
        total: 0,
      },
      total: 0,
    };
  }

  /**
   * Merge two ModelUsage objects by accumulating token counts
   * @param previous - Previous usage statistics
   * @param current - Current usage statistics to add
   * @returns Merged usage statistics
   */
  private static mergeModelUsage(
    previous: ModelUsage | undefined,
    current: ModelUsage,
  ): ModelUsage {
    if (!previous) return current;

    const merged: ModelUsage = { ...current };

    // Accumulate all numeric token fields
    const numericFields: (keyof ModelUsage)[] = [
      'inputCachedTokens',
      'inputCacheMissTokens',
      'inputWriteCacheTokens',
      'inputTextTokens',
      'inputImageTokens',
      'inputAudioTokens',
      'inputCitationTokens',
      'outputTextTokens',
      'outputImageTokens',
      'outputAudioTokens',
      'outputReasoningTokens',
      'acceptedPredictionTokens',
      'rejectedPredictionTokens',
      'totalInputTokens',
      'totalOutputTokens',
      'totalTokens',
    ];

    for (const field of numericFields) {
      const prevValue = previous[field] as number | undefined;
      const currValue = current[field] as number | undefined;

      if (prevValue !== undefined || currValue !== undefined) {
        merged[field] = (prevValue || 0) + (currValue || 0);
      }
    }

    // Accumulate cost
    if (previous.cost !== undefined || current.cost !== undefined) {
      merged.cost = (previous.cost || 0) + (current.cost || 0);
    }

    return merged;
  }

  /**
   * Accumulate LLM usage and cost for a specific model
   * @param params - Accumulation parameters
   * @param params.usage - Current usage statistics (optional, will be created if not provided)
   * @param params.cost - Current cost statistics (optional, will be created if not provided)
   * @param params.provider - Provider name (e.g., "openai")
   * @param params.model - Model name (e.g., "gpt-4")
   * @param params.modelUsage - ModelUsage from model-runtime
   * @returns Updated usage and cost
   */
  static accumulateLLM(params: {
    cost?: Cost;
    model: string;
    modelUsage: ModelUsage;
    provider: string;
    usage?: Usage;
  }): { cost?: Cost; usage: Usage } {
    const { usage, cost, provider, model, modelUsage } = params;

    // Ensure usage exists
    const newUsage = usage ? structuredClone(usage) : this.createDefaultUsage();

    // Accumulate token counts to usage.llm
    newUsage.llm.tokens.input += modelUsage.totalInputTokens ?? 0;
    newUsage.llm.tokens.output += modelUsage.totalOutputTokens ?? 0;
    newUsage.llm.tokens.total += modelUsage.totalTokens ?? 0;
    newUsage.llm.apiCalls += 1;

    // Ensure cost exists if modelUsage has cost
    let newCost = cost
      ? structuredClone(cost)
      : modelUsage.cost
        ? this.createDefaultCost()
        : undefined;

    if (modelUsage.cost && newCost) {
      const modelId = `${provider}/${model}`;

      // Find or create byModel entry
      let modelEntry = newCost.llm.byModel.find((entry) => entry.id === modelId);

      if (!modelEntry) {
        modelEntry = {
          id: modelId,
          model,
          provider,
          totalCost: 0,
          usage: {},
        };
        newCost.llm.byModel.push(modelEntry);
      }

      // Merge usage breakdown
      modelEntry.usage = UsageCounter.mergeModelUsage(modelEntry.usage, modelUsage);

      // Accumulate costs
      modelEntry.totalCost += modelUsage.cost;
      newCost.llm.total += modelUsage.cost;
      newCost.total += modelUsage.cost;
      newCost.calculatedAt = new Date().toISOString();
    }

    return { cost: newCost, usage: newUsage };
  }

  /**
   * Accumulate tool usage and cost
   * @param params - Accumulation parameters
   * @param params.usage - Current usage statistics (optional, will be created if not provided)
   * @param params.cost - Current cost statistics (optional, will be created if not provided)
   * @param params.toolName - Tool identifier
   * @param params.executionTime - Execution time in milliseconds
   * @param params.success - Whether the execution was successful
   * @param params.toolCost - Optional cost for this tool call
   * @returns Updated usage and cost
   */
  static accumulateTool(params: {
    cost?: Cost;
    executionTime: number;
    success: boolean;
    toolCost?: number;
    toolName: string;
    usage?: Usage;
  }): { cost?: Cost; usage: Usage } {
    const { usage, cost, toolName, executionTime, success, toolCost } = params;

    // Ensure usage exists
    const newUsage = usage ? structuredClone(usage) : this.createDefaultUsage();

    // Find or create byTool entry
    let toolEntry = newUsage.tools.byTool.find((entry) => entry.name === toolName);

    if (!toolEntry) {
      toolEntry = {
        calls: 0,
        errors: 0,
        name: toolName,
        totalTimeMs: 0,
      };
      newUsage.tools.byTool.push(toolEntry);
    }

    // Accumulate tool usage
    toolEntry.calls += 1;
    toolEntry.totalTimeMs += executionTime;
    if (!success) {
      toolEntry.errors += 1;
    }

    newUsage.tools.totalCalls += 1;
    newUsage.tools.totalTimeMs += executionTime;

    // Ensure cost exists if toolCost is provided
    let newCost = cost ? structuredClone(cost) : toolCost ? this.createDefaultCost() : undefined;

    if (toolCost && newCost) {
      let toolCostEntry = newCost.tools.byTool.find((entry) => entry.name === toolName);

      if (!toolCostEntry) {
        toolCostEntry = {
          calls: 0,
          currency: 'USD',
          name: toolName,
          totalCost: 0,
        };
        newCost.tools.byTool.push(toolCostEntry);
      }

      toolCostEntry.calls += 1;
      toolCostEntry.totalCost += toolCost;
      newCost.tools.total += toolCost;
      newCost.total += toolCost;
      newCost.calculatedAt = new Date().toISOString();
    }

    return { cost: newCost, usage: newUsage };
  }
}
