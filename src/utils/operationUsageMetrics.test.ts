import { describe, expect, it } from 'vitest';

import {
  addUsageToOperationMetrics,
  calculateOperationUsageMetrics,
  EMPTY_OPERATION_USAGE_METRICS,
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

  describe('sub-agent spend', () => {
    const subAgentTool = (pluginState: any, parentId = 'assistant') => ({
      id: 'tool-msg',
      parentId,
      plugin: { identifier: 'lobe-agent' },
      pluginState,
      role: 'tool',
    });

    // The sub-agent's own assistant turns live in an isolation thread the parent
    // never loads, so its callSubAgent tool row is the ONLY place its spend can
    // enter the parent's tray.
    it("folds a finished sub-agent's spend in via its callSubAgent tool row", () => {
      const metrics = calculateOperationUsageMetrics(
        [
          { id: 'assistant', role: 'assistant', usage: { cost: 0.01, totalTokens: 100 } },
          subAgentTool({
            status: 'completed',
            totalCost: 0.5,
            totalInputTokens: 4000,
            totalOutputTokens: 1000,
            totalTokens: 5000,
          }),
        ] as any,
        new Set(['op-1']),
        { assistant: ['op-1'] },
      );

      expect(metrics).toEqual({
        totalCost: 0.51,
        totalInputTokens: 4000,
        totalOutputTokens: 1000,
        totalTokens: 5100,
      });
    });

    // A tool row is never a key in operationsByMessage — only assistant messages
    // are registered there — so attribution has to go through parentId.
    it('attributes the tool row through its parent assistant, not its own id', () => {
      const metrics = calculateOperationUsageMetrics(
        [subAgentTool({ totalCost: 0.5, totalTokens: 5000 })] as any,
        new Set(['op-1']),
        { 'tool-msg': ['op-1'] },
      );

      expect(metrics).toEqual(EMPTY_OPERATION_USAGE_METRICS);
    });

    it('ignores a sub-agent belonging to a different operation', () => {
      const metrics = calculateOperationUsageMetrics(
        [subAgentTool({ totalCost: 0.5, totalTokens: 5000 })] as any,
        new Set(['op-1']),
        { assistant: ['op-2'] },
      );

      expect(metrics).toEqual(EMPTY_OPERATION_USAGE_METRICS);
    });

    it('ignores tool rows from other builtins', () => {
      const metrics = calculateOperationUsageMetrics(
        [
          {
            id: 'tool-msg',
            parentId: 'assistant',
            plugin: { identifier: 'lobe-web-browsing' },
            pluginState: { totalCost: 99, totalTokens: 99_999 },
            role: 'tool',
          },
        ] as any,
        new Set(['op-1']),
        { assistant: ['op-1'] },
      );

      expect(metrics).toEqual(EMPTY_OPERATION_USAGE_METRICS);
    });

    it('uses the live progress totals while the sub-agent is still running', () => {
      const metrics = calculateOperationUsageMetrics(
        [
          subAgentTool({ progress: { totalCost: 0.2, totalTokens: 2000 }, status: 'pending' }),
        ] as any,
        new Set(['op-1']),
        { assistant: ['op-1'] },
      );

      expect(metrics).toEqual({
        totalCost: 0.2,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 2000,
      });
    });

    // Once the bridge backfills the authoritative flat totals, a stale live sample
    // must not win — otherwise the tray would visibly regress at the end of a run.
    it('prefers the backfilled totals over a stale live sample', () => {
      const metrics = calculateOperationUsageMetrics(
        [
          subAgentTool({
            progress: { totalCost: 0.2, totalTokens: 2000 },
            status: 'completed',
            totalCost: 0.5,
            totalTokens: 5000,
          }),
        ] as any,
        new Set(['op-1']),
        { assistant: ['op-1'] },
      );

      expect(metrics.totalCost).toBe(0.5);
      expect(metrics.totalTokens).toBe(5000);
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
