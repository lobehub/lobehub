import type { AssistantContentBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { MessageTransformer } from '../MessageTransformer';

describe('MessageTransformer', () => {
  const transformer = new MessageTransformer();

  describe('messageToContentBlock', () => {
    it('should convert message to content block', () => {
      const message: Message = {
        content: 'Hello',
        createdAt: 0,
        id: 'msg-1',
        metadata: {
          cost: 0.001,
          duration: 1000,
          totalInputTokens: 10,
          totalOutputTokens: 20,
          totalTokens: 30,
          tps: 20,
        },
        role: 'assistant',
        updatedAt: 0,
      };

      const result = transformer.messageToContentBlock(message);

      expect(result).toEqual({
        content: 'Hello',
        error: undefined,
        id: 'msg-1',
        imageList: undefined,
        performance: {
          duration: 1000,
          tps: 20,
        },
        reasoning: undefined,
        tools: undefined,
        usage: {
          cost: 0.001,
          totalInputTokens: 10,
          totalOutputTokens: 20,
          totalTokens: 30,
        },
      });
    });

    it('should handle message without metadata', () => {
      const message: Message = {
        content: 'Hello',
        createdAt: 0,
        id: 'msg-1',
        role: 'assistant',
        updatedAt: 0,
      };

      const result = transformer.messageToContentBlock(message);

      expect(result.usage).toBeUndefined();
      expect(result.performance).toBeUndefined();
    });

    it('should prefer top-level usage over metadata.usage', () => {
      const message: Message = {
        content: 'Hello',
        createdAt: 0,
        id: 'msg-1',
        metadata: { usage: { cost: 0.001, totalTokens: 100 } },
        role: 'assistant',
        updatedAt: 0,
        usage: { cost: 0.002, totalTokens: 200 },
      };

      const result = transformer.messageToContentBlock(message);

      expect(result.usage).toEqual({ cost: 0.002, totalTokens: 200 });
    });
  });

  describe('splitMetadata', () => {
    it('should split metadata into usage and performance', () => {
      const metadata = {
        cost: 0.001,
        duration: 1000,
        latency: 1100,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalTokens: 30,
        tps: 20,
        ttft: 100,
      };

      const result = transformer.splitMetadata(metadata);

      expect(result.usage).toEqual({
        cost: 0.001,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalTokens: 30,
      });

      expect(result.performance).toEqual({
        duration: 1000,
        latency: 1100,
        tps: 20,
        ttft: 100,
      });
    });

    it('should handle undefined metadata', () => {
      const result = transformer.splitMetadata(undefined);

      expect(result).toEqual({});
    });

    it('should handle empty metadata', () => {
      const result = transformer.splitMetadata({});

      expect(result).toEqual({
        performance: undefined,
        usage: undefined,
      });
    });

    it('should handle partial metadata', () => {
      const result = transformer.splitMetadata({
        cost: 0.001,
        duration: 1000,
      });

      expect(result.usage).toEqual({
        cost: 0.001,
      });

      expect(result.performance).toEqual({
        duration: 1000,
      });
    });

    it('should use metadata.usage only as a fallback for missing top-level fields', () => {
      const result = transformer.splitMetadata(
        { usage: { cost: 0.001, totalInputTokens: 10, totalTokens: 100 } },
        { cost: 0.002, totalTokens: 200 },
      );

      expect(result.usage).toEqual({
        cost: 0.002,
        totalInputTokens: 10,
        totalTokens: 200,
      });
    });
  });

  describe('aggregateMetadata', () => {
    it('should aggregate usage and performance from multiple children', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
          performance: {
            duration: 1000,
            latency: 1100,
            tps: 20,
            ttft: 100,
          },
          usage: {
            cost: 0.001,
            totalInputTokens: 10,
            totalOutputTokens: 20,
            totalTokens: 30,
          },
        },
        {
          content: 'Second',
          id: 'msg-2',
          performance: {
            duration: 2000,
            latency: 2100,
            tps: 30,
          },
          usage: {
            cost: 0.002,
            totalInputTokens: 15,
            totalOutputTokens: 25,
            totalTokens: 40,
          },
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result.usage).toEqual({
        cost: 0.003,
        totalInputTokens: 25,
        totalOutputTokens: 45,
        totalTokens: 70,
      });

      expect(result.performance).toEqual({
        duration: 3000,
        latency: 3200,
        tps: 15, // 45 output tokens over 3 seconds
        ttft: 100, // first value
      });
    });

    it('should handle empty children array', () => {
      const result = transformer.aggregateMetadata([]);

      expect(result).toEqual({
        performance: undefined,
        usage: undefined,
      });
    });

    it('should handle children without metadata', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
        },
        {
          content: 'Second',
          id: 'msg-2',
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result).toEqual({
        performance: undefined,
        usage: undefined,
      });
    });

    it('should handle mixed children (some with metadata, some without)', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
          usage: {
            cost: 0.001,
            totalTokens: 30,
          },
        },
        {
          content: 'Second',
          id: 'msg-2',
        },
        {
          content: 'Third',
          id: 'msg-3',
          usage: {
            cost: 0.002,
            totalTokens: 40,
          },
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result.usage).toEqual({
        cost: 0.003,
        totalTokens: 70,
      });
    });

    it('should divide total output tokens by total generation time', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
          performance: { duration: 1000, tps: 500 },
          usage: { totalOutputTokens: 500 },
        },
        {
          content: 'Second',
          id: 'msg-2',
          performance: { duration: 20_000, tps: 50 },
          usage: { totalOutputTokens: 1000 },
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result.performance?.tps).toBeCloseTo(1500 / 21);
    });

    it.each([
      [undefined, 1000],
      [100, undefined],
      [100, 0],
      [100, -1],
      [100, Number.NaN],
      [100, Number.POSITIVE_INFINITY],
      [-1, 1000],
      [Number.NaN, 1000],
      [Number.POSITIVE_INFINITY, 1000],
    ])('should exclude invalid token/time pairs (%s, %s) from TPS', (tokens, duration) => {
      const children: AssistantContentBlock[] = [
        {
          content: 'Valid',
          id: 'valid',
          performance: { duration: 2000, tps: 50 },
          usage: { totalOutputTokens: 100 },
        },
        {
          content: 'Incomplete',
          id: 'incomplete',
          performance: { duration, tps: 1000 },
          usage: { totalOutputTokens: tokens },
        },
      ];

      expect(transformer.aggregateMetadata(children).performance?.tps).toBe(50);
      expect(transformer.aggregateMetadata(children.slice(1)).performance?.tps).toBeUndefined();
    });

    it('should include reasoning tokens once and preserve single-call generation speed', () => {
      const result = transformer.aggregateMetadata([
        {
          content: 'Answer',
          id: 'msg-1',
          performance: { duration: 2000, latency: 5000, tps: 50, ttft: 3000 },
          usage: { outputReasoningTokens: 80, outputTextTokens: 20, totalOutputTokens: 100 },
        },
      ]);

      expect(result.performance?.tps).toBe(50);
    });

    it('should include measured zero-output calls without requiring a stored TPS', () => {
      const result = transformer.aggregateMetadata([
        { content: '', id: 'a', performance: { duration: 1000 }, usage: { totalOutputTokens: 0 } },
        {
          content: 'Answer',
          id: 'b',
          performance: { duration: 1000 },
          usage: { totalOutputTokens: 100 },
        },
      ]);

      expect(result.performance?.tps).toBe(50);
    });

    it('should take first ttft value only', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
          performance: { ttft: 100 },
        },
        {
          content: 'Second',
          id: 'msg-2',
          performance: { ttft: 200 },
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result.performance?.ttft).toBe(100); // first value only
    });
  });
});
