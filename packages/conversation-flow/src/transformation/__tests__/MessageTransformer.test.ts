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
        tps: 25, // average of 20 and 30
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

    it('should average tps correctly', () => {
      const children: AssistantContentBlock[] = [
        {
          content: 'First',
          id: 'msg-1',
          performance: { tps: 10 },
        },
        {
          content: 'Second',
          id: 'msg-2',
          performance: { tps: 20 },
        },
        {
          content: 'Third',
          id: 'msg-3',
          performance: { tps: 30 },
        },
      ];

      const result = transformer.aggregateMetadata(children);

      expect(result.performance?.tps).toBe(20); // average of 10, 20, 30
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
