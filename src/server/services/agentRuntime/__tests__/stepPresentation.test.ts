// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildStepPresentation, formatTokenCount } from '../stepPresentation';

const baseState = {
  cost: { total: 0.5 },
  stepCount: 3,
  usage: { llm: { apiCalls: 2, tokens: { input: 100, output: 50, total: 150 } } },
};

describe('buildStepPresentation', () => {
  describe('phase=tool_result', () => {
    it('extracts a single-tool result with serialized JSON output', () => {
      const { presentation, summary } = buildStepPresentation(
        {
          events: [],
          newState: baseState,
          nextContext: {
            payload: {
              data: { ok: true, rows: 7 },
              isSuccess: true,
              toolCall: { apiName: 'query', identifier: 'sql' },
            },
            phase: 'tool_result',
          },
        },
        120,
      );

      expect(summary).toBe('[tool] sql/query');
      expect(presentation.toolsResult).toEqual([
        {
          apiName: 'query',
          identifier: 'sql',
          isSuccess: true,
          output: '{"ok":true,"rows":7}',
        },
      ]);
      expect(presentation.stepType).toBe('call_tool');
      expect(presentation.thinking).toBe(false);
      expect(presentation.executionTimeMs).toBe(120);
    });

    it('passes string output through verbatim', () => {
      const { presentation } = buildStepPresentation(
        {
          newState: baseState,
          nextContext: {
            payload: {
              data: 'plain text',
              toolCall: { apiName: 'echo', identifier: 'sys' },
            },
            phase: 'tool_result',
          },
        },
        50,
      );

      expect(presentation.toolsResult?.[0].output).toBe('plain text');
    });

    it('marks isSuccess=false explicitly when payload says so', () => {
      const { presentation } = buildStepPresentation(
        {
          newState: baseState,
          nextContext: {
            payload: {
              data: 'oops',
              isSuccess: false,
              toolCall: { apiName: 'fn', identifier: 'x' },
            },
            phase: 'tool_result',
          },
        },
        10,
      );

      expect(presentation.toolsResult?.[0].isSuccess).toBe(false);
    });
  });

  describe('phase=tools_batch_result', () => {
    it('summarizes batch with [tools×N] header and joined names', () => {
      const { summary, presentation } = buildStepPresentation(
        {
          newState: baseState,
          nextContext: {
            payload: {
              toolCount: 2,
              toolResults: [
                { data: 'a', toolCall: { apiName: 'r', identifier: 'fs' } },
                { data: { x: 1 }, toolCall: { apiName: 'q', identifier: 'sql' } },
              ],
            },
            phase: 'tools_batch_result',
          },
        },
        40,
      );

      expect(summary).toBe('[tools×2] fs/r, sql/q');
      expect(presentation.toolsResult).toHaveLength(2);
      expect(presentation.toolsResult?.[1].output).toBe('{"x":1}');
    });
  });

  describe('phase=other / done event', () => {
    it('summarizes done events with reason', () => {
      const { summary, presentation } = buildStepPresentation(
        {
          events: [{ reason: 'max_steps', type: 'done' }],
          newState: baseState,
          nextContext: undefined,
        },
        10,
      );

      expect(summary).toBe('[done] reason=max_steps');
      expect(presentation.thinking).toBe(true);
      expect(presentation.stepType).toBe('call_llm');
    });
  });

  describe('phase=other / llm_result', () => {
    it('extracts content + reasoning + tool calls from llm_result event', () => {
      const { presentation, summary } = buildStepPresentation(
        {
          events: [
            {
              result: { content: 'final answer', reasoning: 'thinking out loud' },
              type: 'llm_result',
            },
          ],
          newState: baseState,
          nextContext: {
            payload: {
              toolsCalling: [{ apiName: 'q', arguments: '{}', identifier: 'sql' }],
            },
            phase: 'tool_use',
          },
        },
        25,
      );

      expect(presentation.content).toBe('final answer');
      expect(presentation.reasoning).toBe('thinking out loud');
      expect(presentation.toolsCalling).toEqual([
        { apiName: 'q', arguments: '{}', identifier: 'sql' },
      ]);
      // summary should include the reasoning preview AND content preview
      expect(summary).toContain('💭 "thinking out loud"');
      expect(summary).toContain('"final answer"');
    });

    it('shows the call-tools arrow when there is no content but tools are calling', () => {
      const { summary } = buildStepPresentation(
        {
          events: [{ result: { content: '', reasoning: undefined }, type: 'llm_result' }],
          newState: baseState,
          nextContext: {
            payload: {
              toolsCalling: [{ apiName: 'q', arguments: '{}', identifier: 'sql' }],
            },
            phase: 'tool_use',
          },
        },
        25,
      );

      expect(summary).toContain('→ call tools: sql|q');
    });

    it('falls back to (empty) summary when no content / reasoning / tools', () => {
      const { summary } = buildStepPresentation(
        {
          events: [],
          newState: baseState,
          nextContext: { phase: 'tool_use' },
        },
        25,
      );

      expect(summary).toContain('[llm] (empty)');
      expect(summary).toContain('phase=tool_use');
    });
  });

  describe('cumulative usage', () => {
    it('falls back to zeros when usage/cost are absent', () => {
      const { presentation } = buildStepPresentation(
        { newState: { stepCount: 0 }, nextContext: undefined },
        0,
      );

      expect(presentation.totalCost).toBe(0);
      expect(presentation.totalInputTokens).toBe(0);
      expect(presentation.totalOutputTokens).toBe(0);
      expect(presentation.totalTokens).toBe(0);
      expect(presentation.totalSteps).toBe(0);
    });

    it('forwards stepUsage values when nextContext carries them', () => {
      const { presentation } = buildStepPresentation(
        {
          newState: baseState,
          nextContext: {
            phase: 'user_input',
            stepUsage: {
              cost: 0.02,
              totalInputTokens: 30,
              totalOutputTokens: 20,
              totalTokens: 50,
            },
          },
        },
        15,
      );

      expect(presentation.stepCost).toBe(0.02);
      expect(presentation.stepInputTokens).toBe(30);
      expect(presentation.stepOutputTokens).toBe(20);
      expect(presentation.stepTotalTokens).toBe(50);
    });
  });
});

describe('formatTokenCount', () => {
  it('renders <1k as raw integer', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('renders 1k–999.9k with one decimal and k suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(12_345)).toBe('12.3k');
  });

  it('renders ≥1m with one decimal and m suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0m');
    expect(formatTokenCount(2_500_000)).toBe('2.5m');
  });
});
