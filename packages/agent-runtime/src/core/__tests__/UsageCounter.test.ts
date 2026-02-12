import type { ModelUsage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { AgentRuntime } from '../runtime';
import { UsageCounter } from '../UsageCounter';

describe('UsageCounter', () => {
  describe('UsageCounter.accumulateLLM', () => {
    it('should accumulate LLM usage tokens', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { usage } = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage,
        provider: 'openai',
        usage: state.usage,
      });

      expect(usage.llm.tokens.input).toBe(100);
      expect(usage.llm.tokens.output).toBe(50);
      expect(usage.llm.tokens.total).toBe(150);
      expect(usage.llm.apiCalls).toBe(1);
    });

    it('should not mutate original usage', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { usage } = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: modelUsage,
        provider: 'openai',
        usage: state.usage,
      });

      expect(state.usage.llm.tokens.input).toBe(0);
      expect(usage).not.toBe(state.usage);
    });

    it('should create new byModel entry when not exists', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { cost } = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: modelUsage,
        provider: 'openai',
        usage: state.usage,
      });

      expect(cost?.llm.byModel).toHaveLength(1);
      expect(cost?.llm.byModel[0]).toEqual({
        id: 'openai/gpt-4',
        model: 'gpt-4',
        provider: 'openai',
        totalCost: 0.05,
        usage: {
          cost: 0.05,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalTokens: 150,
        },
      });
    });

    it('should accumulate to existing byModel entry', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        totalInputTokens: 50,
        totalOutputTokens: 25,
        totalTokens: 75,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel).toHaveLength(1);
      expect(result2.cost?.llm.byModel[0]).toEqual({
        id: 'openai/gpt-4',
        model: 'gpt-4',
        provider: 'openai',
        totalCost: 0.08,
        usage: {
          cost: 0.08,
          totalInputTokens: 150,
          totalOutputTokens: 75,
          totalTokens: 225,
        },
      });
    });

    it('should accumulate multiple models separately', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ModelUsage = {
        cost: 0.02,
        totalInputTokens: 50,
        totalOutputTokens: 25,
        totalTokens: 75,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage2,
        provider: 'anthropic',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel).toHaveLength(2);
      expect(result2.cost?.llm.byModel[0].id).toBe('openai/gpt-4');
      expect(result2.cost?.llm.byModel[1].id).toBe('anthropic/claude-3-5-sonnet-20241022');
    });

    it('should accumulate cache-related tokens', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        cost: 0.05,
        inputCacheMissTokens: 60,
        inputCachedTokens: 40,
        inputWriteCacheTokens: 20,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { cost } = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: modelUsage,
        provider: 'anthropic',
        usage: state.usage,
      });

      expect(cost?.llm.byModel[0].usage).toEqual({
        cost: 0.05,
        inputCacheMissTokens: 60,
        inputCachedTokens: 40,
        inputWriteCacheTokens: 20,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      });
    });

    it('should accumulate total costs correctly', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        totalInputTokens: 50,
        totalOutputTokens: 25,
        totalTokens: 75,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage2,
        provider: 'anthropic',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.total).toBe(0.08);
      expect(result2.cost?.total).toBe(0.08);
      expect(result2.cost?.calculatedAt).toBeDefined();
    });

    it('should not accumulate cost when usage.cost is undefined', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { cost } = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: modelUsage,
        provider: 'openai',
        usage: state.usage,
      });

      expect(cost?.llm.byModel).toHaveLength(0);
      expect(cost?.llm.total).toBe(0);
      expect(cost?.total).toBe(0);
    });

    it('should increment apiCalls for each accumulation', () => {
      const state = AgentRuntime.createInitialState();

      const modelUsage: ModelUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: modelUsage,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4',
        modelUsage: modelUsage,
        provider: 'openai',
        usage: result1.usage,
      });
      const result3 = UsageCounter.accumulateLLM({
        cost: result2.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: modelUsage,
        provider: 'anthropic',
        usage: result2.usage,
      });

      expect(result3.usage.llm.apiCalls).toBe(3);
    });

    it('should auto-create usage and cost when not provided', () => {
      const modelUsage: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const { usage, cost } = UsageCounter.accumulateLLM({
        model: 'gpt-4',
        modelUsage,
        provider: 'openai',
      });

      expect(usage).toBeDefined();
      expect(usage.llm.tokens.input).toBe(100);
      expect(usage.llm.tokens.output).toBe(50);
      expect(usage.llm.tokens.total).toBe(150);
      expect(usage.llm.apiCalls).toBe(1);

      expect(cost).toBeDefined();
      expect(cost?.total).toBe(0.05);
      expect(cost?.llm.total).toBe(0.05);
    });
  });

  describe('UsageCounter.accumulateTool', () => {
    it('should accumulate tool usage', () => {
      const state = AgentRuntime.createInitialState();

      const { usage } = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolName: 'search',
        usage: state.usage,
      });

      expect(usage.tools.byTool).toHaveLength(1);
      expect(usage.tools.byTool[0]).toEqual({
        calls: 1,
        errors: 0,
        name: 'search',
        totalTimeMs: 1000,
      });
      expect(usage.tools.totalCalls).toBe(1);
      expect(usage.tools.totalTimeMs).toBe(1000);
    });

    it('should not mutate original usage', () => {
      const state = AgentRuntime.createInitialState();

      const { usage } = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolName: 'search',
        usage: state.usage,
      });

      expect(state.usage.tools.totalCalls).toBe(0);
      expect(usage).not.toBe(state.usage);
    });

    it('should accumulate errors when success is false', () => {
      const state = AgentRuntime.createInitialState();

      const { usage } = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: false,
        toolName: 'search',
        usage: state.usage,
      });

      expect(usage.tools.byTool[0]).toEqual({
        calls: 1,
        errors: 1,
        name: 'search',
        totalTimeMs: 1000,
      });
    });

    it('should accumulate multiple tool calls', () => {
      const state = AgentRuntime.createInitialState();

      const result1 = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolName: 'search',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateTool({
        cost: result1.cost,
        executionTime: 500,
        success: true,
        toolName: 'search',
        usage: result1.usage,
      });
      const result3 = UsageCounter.accumulateTool({
        cost: result2.cost,
        executionTime: 200,
        success: false,
        toolName: 'calculator',
        usage: result2.usage,
      });

      expect(result3.usage.tools.byTool).toHaveLength(2);
      expect(result3.usage.tools.byTool.find((t) => t.name === 'search')).toEqual({
        calls: 2,
        errors: 0,
        name: 'search',
        totalTimeMs: 1500,
      });
      expect(result3.usage.tools.byTool.find((t) => t.name === 'calculator')).toEqual({
        calls: 1,
        errors: 1,
        name: 'calculator',
        totalTimeMs: 200,
      });
      expect(result3.usage.tools.totalCalls).toBe(3);
      expect(result3.usage.tools.totalTimeMs).toBe(1700);
    });

    it('should accumulate tool cost when provided', () => {
      const state = AgentRuntime.createInitialState();

      const { cost } = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolCost: 0.01,
        toolName: 'premium-search',
        usage: state.usage,
      });

      expect(cost?.tools.byTool).toHaveLength(1);
      expect(cost?.tools.byTool[0]).toEqual({
        calls: 1,
        currency: 'USD',
        name: 'premium-search',
        totalCost: 0.01,
      });
      expect(cost?.tools.total).toBe(0.01);
      expect(cost?.total).toBe(0.01);
    });

    it('should accumulate tool cost across multiple calls', () => {
      const state = AgentRuntime.createInitialState();

      const result1 = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolCost: 0.01,
        toolName: 'premium-search',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateTool({
        cost: result1.cost,
        executionTime: 500,
        success: true,
        toolCost: 0.005,
        toolName: 'premium-search',
        usage: result1.usage,
      });

      expect(result2.cost?.tools.byTool).toHaveLength(1);
      expect(result2.cost?.tools.byTool[0]).toEqual({
        calls: 2,
        currency: 'USD',
        name: 'premium-search',
        totalCost: 0.015,
      });
      expect(result2.cost?.tools.total).toBe(0.015);
      expect(result2.cost?.total).toBe(0.015);
    });

    it('should not accumulate cost when cost is undefined', () => {
      const state = AgentRuntime.createInitialState();

      const { cost } = UsageCounter.accumulateTool({
        cost: state.cost,
        executionTime: 1000,
        success: true,
        toolName: 'free-tool',
        usage: state.usage,
      });

      expect(cost?.tools.byTool).toHaveLength(0);
      expect(cost?.tools.total).toBe(0);
    });
  });

  describe('mixed accumulation', () => {
    it('should accumulate both LLM and tool costs correctly', () => {
      const state = AgentRuntime.createInitialState();

      const llmUsage: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: llmUsage,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateTool({
        cost: result1.cost,
        executionTime: 1000,
        success: true,
        toolCost: 0.01,
        toolName: 'premium-search',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.total).toBe(0.05);
      expect(result2.cost?.tools.total).toBe(0.01);
      expect(result2.cost?.total).toBeCloseTo(0.06);
    });
  });

  describe('mergeModelUsage (private method tests via accumulateLLM)', () => {
    it('should merge basic token counts', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalTokens: 300,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        cost: 0.08,
        totalInputTokens: 300,
        totalOutputTokens: 150,
        totalTokens: 450,
      });
    });

    it('should merge cache-related tokens', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        inputCacheMissTokens: 30,
        inputCachedTokens: 50,
        inputWriteCacheTokens: 20,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        inputCacheMissTokens: 40,
        inputCachedTokens: 80,
        inputWriteCacheTokens: 30,
        totalInputTokens: 150,
        totalOutputTokens: 75,
        totalTokens: 225,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage1,
        provider: 'anthropic',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage2,
        provider: 'anthropic',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        cost: 0.08,
        inputCacheMissTokens: 70,
        inputCachedTokens: 130,
        inputWriteCacheTokens: 50,
        totalInputTokens: 250,
        totalOutputTokens: 125,
        totalTokens: 375,
      });
    });

    it('should merge reasoning tokens', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        outputReasoningTokens: 100,
        outputTextTokens: 200,
        totalInputTokens: 100,
        totalOutputTokens: 300,
        totalTokens: 400,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        outputReasoningTokens: 50,
        outputTextTokens: 100,
        totalInputTokens: 50,
        totalOutputTokens: 150,
        totalTokens: 200,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'o1',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'o1',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        cost: 0.08,
        outputReasoningTokens: 150,
        outputTextTokens: 300,
        totalInputTokens: 150,
        totalOutputTokens: 450,
        totalTokens: 600,
      });
    });

    it('should merge audio and image tokens', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        inputAudioTokens: 10,
        inputImageTokens: 20,
        outputAudioTokens: 5,
        outputImageTokens: 15,
        totalInputTokens: 30,
        totalOutputTokens: 20,
        totalTokens: 50,
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        inputAudioTokens: 15,
        inputImageTokens: 25,
        outputAudioTokens: 8,
        outputImageTokens: 12,
        totalInputTokens: 40,
        totalOutputTokens: 20,
        totalTokens: 60,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4o-audio-preview',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4o-audio-preview',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        cost: 0.08,
        inputAudioTokens: 25,
        inputImageTokens: 45,
        outputAudioTokens: 13,
        outputImageTokens: 27,
        totalInputTokens: 70,
        totalOutputTokens: 40,
        totalTokens: 110,
      });
    });

    it('should merge prediction tokens', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        acceptedPredictionTokens: 50,
        cost: 0.05,
        rejectedPredictionTokens: 10,
        totalInputTokens: 100,
        totalOutputTokens: 60,
        totalTokens: 160,
      };

      const usage2: ModelUsage = {
        acceptedPredictionTokens: 30,
        cost: 0.03,
        rejectedPredictionTokens: 5,
        totalInputTokens: 50,
        totalOutputTokens: 35,
        totalTokens: 85,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4o',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4o',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        acceptedPredictionTokens: 80,
        cost: 0.08,
        rejectedPredictionTokens: 15,
        totalInputTokens: 150,
        totalOutputTokens: 95,
        totalTokens: 245,
      });
    });

    it('should handle missing fields gracefully', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        cost: 0.05,
        totalInputTokens: 100,
        // totalOutputTokens is missing
      };

      const usage2: ModelUsage = {
        cost: 0.03,
        totalOutputTokens: 50,
        // totalInputTokens is missing
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'gpt-4',
        modelUsage: usage1,
        provider: 'openai',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'gpt-4',
        modelUsage: usage2,
        provider: 'openai',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        cost: 0.08,
        totalInputTokens: 100,
        totalOutputTokens: 50,
      });
    });

    it('should merge all fields in a comprehensive scenario', () => {
      const state = AgentRuntime.createInitialState();

      const usage1: ModelUsage = {
        acceptedPredictionTokens: 10,
        cost: 0.05,
        inputAudioTokens: 5,
        inputCacheMissTokens: 40,
        inputCachedTokens: 60,
        inputCitationTokens: 10,
        inputImageTokens: 20,
        inputTextTokens: 100,
        inputWriteCacheTokens: 30,
        outputAudioTokens: 3,
        outputImageTokens: 8,
        outputReasoningTokens: 20,
        outputTextTokens: 50,
        rejectedPredictionTokens: 5,
        totalInputTokens: 200,
        totalOutputTokens: 80,
        totalTokens: 280,
      };

      const usage2: ModelUsage = {
        acceptedPredictionTokens: 5,
        cost: 0.03,
        inputAudioTokens: 3,
        inputCacheMissTokens: 20,
        inputCachedTokens: 30,
        inputCitationTokens: 5,
        inputImageTokens: 10,
        inputTextTokens: 50,
        inputWriteCacheTokens: 15,
        outputAudioTokens: 2,
        outputImageTokens: 4,
        outputReasoningTokens: 10,
        outputTextTokens: 25,
        rejectedPredictionTokens: 2,
        totalInputTokens: 100,
        totalOutputTokens: 40,
        totalTokens: 140,
      };

      const result1 = UsageCounter.accumulateLLM({
        cost: state.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage1,
        provider: 'anthropic',
        usage: state.usage,
      });
      const result2 = UsageCounter.accumulateLLM({
        cost: result1.cost,
        model: 'claude-3-5-sonnet-20241022',
        modelUsage: usage2,
        provider: 'anthropic',
        usage: result1.usage,
      });

      expect(result2.cost?.llm.byModel[0].usage).toEqual({
        acceptedPredictionTokens: 15,
        cost: 0.08,
        inputAudioTokens: 8,
        inputCacheMissTokens: 60,
        inputCachedTokens: 90,
        inputCitationTokens: 15,
        inputImageTokens: 30,
        inputTextTokens: 150,
        inputWriteCacheTokens: 45,
        outputAudioTokens: 5,
        outputImageTokens: 12,
        outputReasoningTokens: 30,
        outputTextTokens: 75,
        rejectedPredictionTokens: 7,
        totalInputTokens: 300,
        totalOutputTokens: 120,
        totalTokens: 420,
      });
    });
  });
});
