import { describe, expect, it } from 'vitest';

import {
  addUsageToOperationMetrics,
  calculateOperationUsageMetrics,
  hasOperationUsageMetrics,
} from './operationUsageMetrics';

describe('operationUsageMetrics', () => {
  describe('calculateOperationUsageMetrics', () => {
    it('sums only assistant usage associated with the current operation', () => {
      const metrics = calculateOperationUsageMetrics(
        [
          { id: 'old-step', role: 'assistant', usage: { cost: 9, totalTokens: 9_000_000 } },
          {
            id: 'current-step-1',
            role: 'assistant',
            usage: { cost: 1, totalInputTokens: 900, totalOutputTokens: 300, totalTokens: 1200 },
          },
          {
            id: 'current-step-2',
            role: 'assistant',
            usage: { cost: 2, totalInputTokens: 700, totalOutputTokens: 100, totalTokens: 800 },
          },
          { id: 'current-tool', role: 'tool', usage: { cost: 9, totalTokens: 999_999 } },
          { id: 'unmapped', role: 'assistant', usage: { cost: 0.5, totalTokens: 5000 } },
        ],
        new Set(['op-current']),
        {
          'current-step-1': ['op-current'],
          'current-step-2': ['op-current', 'reasoning-op'],
          'current-tool': ['op-current'],
          'old-step': ['op-old'],
        },
      );

      expect(metrics).toEqual({
        totalCost: 3,
        totalInputTokens: 1600,
        totalOutputTokens: 400,
        totalTokens: 2000,
      });
    });

    it('returns zero metrics when no runtime operation is active', () => {
      const metrics = calculateOperationUsageMetrics(
        [{ id: 'message', role: 'assistant', usage: { cost: 0.01, totalTokens: 100 } }],
        new Set(),
        { message: ['op-1'] },
      );

      expect(metrics).toEqual({
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('addUsageToOperationMetrics', () => {
    it('adds a per-step usage delta onto existing operation metrics', () => {
      const metrics = addUsageToOperationMetrics(
        { totalCost: 1, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
        { cost: 2, totalInputTokens: 300, totalOutputTokens: 80, totalTokens: 380 },
      );

      expect(metrics).toEqual({
        totalCost: 3,
        totalInputTokens: 400,
        totalOutputTokens: 130,
        totalTokens: 530,
      });
      expect(hasOperationUsageMetrics(metrics)).toBe(true);
    });
  });
});
