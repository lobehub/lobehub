import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StreamingHandler } from './StreamingHandler';
import { type StreamingCallbacks, type StreamingContext } from './types/streaming';

const createMockCallbacks = (): StreamingCallbacks => ({
  onContentUpdate: vi.fn(),
  onReasoningUpdate: vi.fn(),
  onToolCallsUpdate: vi.fn(),
  onGroundingUpdate: vi.fn(),
  onImagesUpdate: vi.fn(),
  onReasoningStart: vi.fn(() => 'reasoning-op-id'),
  onReasoningComplete: vi.fn(),
  uploadBase64Image: vi.fn(async () => ({ id: 'img-id', url: 'https://s3/img.png' })),
  transformToolCalls: vi.fn((calls) => calls.map((c: any) => ({ ...c, transformed: true }))),
  toggleToolCallingStreaming: vi.fn(),
});

const mockContext: StreamingContext = {
  messageId: 'msg-1',
  operationId: 'op-1',
  agentId: 'agent-1',
};

describe('StreamingHandler', () => {
  describe('handleChunk - text', () => {
    it('should accumulate text output', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Hello ' });
      handler.handleChunk({ type: 'text', text: 'World' });

      expect(handler.getOutput()).toBe('Hello World');
      expect(callbacks.onContentUpdate).toHaveBeenCalledTimes(2);
    });

    it('should clean speaker tag from output', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: '<speaker name="Agent" />\nHello' });

      expect(handler.getOutput()).toBe('Hello');
    });

    it('should clean speaker tag across chunks', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: '<speaker name="' });
      handler.handleChunk({ type: 'text', text: 'Agent" />\n' });
      handler.handleChunk({ type: 'text', text: 'Hello' });

      expect(handler.getOutput()).toBe('Hello');
    });

    it('should not clean speaker tag if it appears in the middle of content', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Some content ' });
      handler.handleChunk({ type: 'text', text: '<speaker name="Agent" /> more' });

      // Speaker tag not at the beginning is not cleaned
      expect(handler.getOutput()).toBe('Some content <speaker name="Agent" /> more');
    });
  });

  describe('handleChunk - reasoning', () => {
    it('should start reasoning timer on first chunk', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking...' });

      expect(callbacks.onReasoningStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onReasoningUpdate).toHaveBeenCalledWith({ content: 'Thinking...' });
    });

    it('should accumulate reasoning content', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Step 1. ' });
      handler.handleChunk({ type: 'reasoning', text: 'Step 2.' });

      expect(callbacks.onReasoningUpdate).toHaveBeenLastCalledWith({
        content: 'Step 1. Step 2.',
      });
    });

    it('should not start reasoning multiple times', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'A' });
      handler.handleChunk({ type: 'reasoning', text: 'B' });
      handler.handleChunk({ type: 'reasoning', text: 'C' });

      expect(callbacks.onReasoningStart).toHaveBeenCalledTimes(1);
    });

    it('should end reasoning when text chunk arrives', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking...' });
      await new Promise((r) => setTimeout(r, 10));
      handler.handleChunk({ type: 'text', text: 'Result' });

      expect(callbacks.onReasoningComplete).toHaveBeenCalledWith('reasoning-op-id');
      expect(handler.getThinkingDuration()).toBeGreaterThan(0);
    });
  });

  describe('handleChunk - reasoning_part', () => {
    it('should handle text reasoning parts', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'text',
        content: 'Thinking...',
      });

      expect(callbacks.onReasoningStart).toHaveBeenCalled();
      expect(callbacks.onReasoningUpdate).toHaveBeenCalledWith({
        content: 'Thinking...',
      });
    });

    it('should merge consecutive text reasoning parts', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'text',
        content: 'Step 1. ',
      });
      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'text',
        content: 'Step 2.',
      });

      expect(callbacks.onReasoningUpdate).toHaveBeenLastCalledWith({
        content: 'Step 1. Step 2.',
      });
    });

    it('should handle image reasoning parts with upload', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'image',
        content: 'base64data',
        mimeType: 'image/png',
      });

      expect(callbacks.onReasoningUpdate).toHaveBeenCalledWith({
        tempDisplayContent: expect.any(Array),
        isMultimodal: true,
      });
      expect(callbacks.uploadBase64Image).toHaveBeenCalled();
    });
  });

  describe('handleChunk - content_part', () => {
    it('should handle text content parts', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'Hello',
      });

      expect(handler.getOutput()).toBe('Hello');
    });

    it('should clean speaker tag from content parts', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: '<speaker name="Agent" />\nHello',
      });

      expect(handler.getOutput()).toBe('Hello');
    });

    it('should handle image content parts with upload', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'content_part',
        partType: 'image',
        content: 'base64data',
        mimeType: 'image/png',
      });

      expect(callbacks.uploadBase64Image).toHaveBeenCalled();

      // Finish to wait for uploads
      await handler.handleFinish({ type: 'stop' });

      expect(callbacks.uploadBase64Image).toHaveBeenCalled();
    });

    it('should merge consecutive text content parts', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'Hello ',
      });
      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'World',
      });

      expect(handler.getOutput()).toBe('Hello World');
    });
  });

  describe('handleChunk - tool_calls', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should mark as function call', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'tool_calls',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      });

      expect(handler.getIsFunctionCall()).toBe(true);
      expect(callbacks.toggleToolCallingStreaming).toHaveBeenCalled();
    });

    it('should throttle tool calls updates', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'tool_calls',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      });

      handler.handleChunk({
        type: 'tool_calls',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      });

      // Initial call happens immediately due to leading: true
      expect(callbacks.onToolCallsUpdate).toHaveBeenCalledTimes(1);

      // Advance timer to allow trailing call
      vi.advanceTimersByTime(300);

      expect(callbacks.onToolCallsUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleChunk - grounding', () => {
    it('should update grounding with citations', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'grounding',
        grounding: {
          citations: [{ title: 'Source 1', url: 'https://example.com' }],
          searchQueries: ['test query'],
        },
      });

      expect(callbacks.onGroundingUpdate).toHaveBeenCalledWith({
        citations: [{ title: 'Source 1', url: 'https://example.com' }],
        searchQueries: ['test query'],
      });
    });

    it('should not update grounding when no citations', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'grounding',
        grounding: { citations: [] },
      });

      expect(callbacks.onGroundingUpdate).not.toHaveBeenCalled();
    });

    it('should not update grounding when grounding is undefined', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'grounding',
        grounding: undefined,
      });

      expect(callbacks.onGroundingUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleChunk - base64_image', () => {
    it('should immediately display images', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'base64_image',
        image: { id: 'img-1', data: 'data:image/png;base64,abc' },
        images: [{ id: 'img-1', data: 'data:image/png;base64,abc' }],
      });

      expect(callbacks.onImagesUpdate).toHaveBeenCalledWith([
        { id: 'img-1', url: 'data:image/png;base64,abc', alt: 'img-1' },
      ]);
    });

    it('should start upload task for image', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'base64_image',
        image: { id: 'img-1', data: 'data:image/png;base64,abc' },
        images: [{ id: 'img-1', data: 'data:image/png;base64,abc' }],
      });

      expect(callbacks.uploadBase64Image).toHaveBeenCalledWith('data:image/png;base64,abc');
    });
  });

  describe('handleChunk - stop', () => {
    it('should end reasoning on stop', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking...' });
      await new Promise((r) => setTimeout(r, 10));
      handler.handleChunk({ type: 'stop' });

      expect(callbacks.onReasoningComplete).toHaveBeenCalledWith('reasoning-op-id');
    });
  });

  describe('handleFinish', () => {
    it('should return correct result for text-only content', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Hello World' });

      const result = await handler.handleFinish({
        type: 'stop',
        usage: { totalTokens: 100 } as any,
      });

      expect(result.content).toBe('Hello World');
      expect(result.isFunctionCall).toBe(false);
      expect(result.metadata.usage?.totalTokens).toBe(100);
    });

    it('should wait for image uploads', async () => {
      const callbacks = createMockCallbacks();
      callbacks.uploadBase64Image = vi.fn(
        (): Promise<{ id?: string; url?: string }> =>
          new Promise((r) => setTimeout(() => r({ id: 'img', url: 'https://s3/img.png' }), 50)),
      );
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'base64_image',
        image: { id: 'img-1', data: 'base64...' },
        images: [{ id: 'img-1', data: 'base64...' }],
      });

      const result = await handler.handleFinish({ type: 'stop' });

      expect(result.metadata.imageList).toHaveLength(1);
      expect(result.metadata.imageList?.[0].url).toBe('https://s3/img.png');
    });

    it('should include reasoning with duration', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking...' });
      await new Promise((r) => setTimeout(r, 20));
      handler.handleChunk({ type: 'text', text: 'Done' });

      const result = await handler.handleFinish({ type: 'stop' });

      expect(result.metadata.reasoning?.content).toBe('Thinking...');
      expect(result.metadata.reasoning?.duration).toBeGreaterThan(0);
    });

    it('should include grounding from finish data', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Content' });

      const result = await handler.handleFinish({
        type: 'stop',
        grounding: {
          citations: [{ title: 'Source', url: 'https://example.com' }],
          searchQueries: ['query'],
        },
      });

      expect(result.metadata.search).toEqual({
        citations: [{ title: 'Source', url: 'https://example.com' }],
        searchQueries: ['query'],
      });
    });

    it('should process tool calls from finish data', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      const result = await handler.handleFinish({
        type: 'stop',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      });

      expect(result.isFunctionCall).toBe(true);
      expect(result.tools).toBeDefined();
      expect(callbacks.transformToolCalls).toHaveBeenCalled();
    });

    it('should handle empty tool call arguments', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      const result = await handler.handleFinish({
        type: 'stop',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: undefined as unknown as string },
          },
        ],
      });

      expect(result.isFunctionCall).toBe(true);
      // Verify arguments were filled with '{}'
      expect(callbacks.transformToolCalls).toHaveBeenCalledWith([
        { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
      ]);
    });

    it('should update traceId from finish data', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Content' });

      const result = await handler.handleFinish({
        type: 'stop',
        traceId: 'trace-123',
      });

      expect(result.traceId).toBe('trace-123');
      expect(handler.getTraceId()).toBe('trace-123');
    });

    it('should use fallback reasoning from finish data when no streaming reasoning', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Content' });

      const result = await handler.handleFinish({
        type: 'stop',
        reasoning: { content: 'Fallback reasoning' },
      });

      expect(result.metadata.reasoning?.content).toBe('Fallback reasoning');
    });

    it('should include reasoning signature from finish data', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking...' });
      await new Promise((r) => setTimeout(r, 10));
      handler.handleChunk({ type: 'text', text: 'Done' });

      const result = await handler.handleFinish({
        type: 'stop',
        reasoning: { content: 'Thinking...', signature: 'test-signature-abc123' },
      });

      expect(result.metadata.reasoning?.content).toBe('Thinking...');
      expect(result.metadata.reasoning?.signature).toBe('test-signature-abc123');
    });

    it('should include reasoning signature with multimodal reasoning', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'text',
        content: 'Thinking with images...',
      });
      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'image',
        content: 'base64data',
        mimeType: 'image/png',
      });
      handler.handleChunk({ type: 'text', text: 'Done' });

      const result = await handler.handleFinish({
        type: 'stop',
        reasoning: { signature: 'multimodal-signature-xyz' },
      });

      expect(result.metadata.reasoning?.isMultimodal).toBe(true);
      expect(result.metadata.reasoning?.signature).toBe('multimodal-signature-xyz');
    });

    it('should use fallback reasoning with signature when no streaming reasoning', async () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Content' });

      const result = await handler.handleFinish({
        type: 'stop',
        reasoning: { content: 'Fallback', signature: 'fallback-sig' },
      });

      expect(result.metadata.reasoning?.content).toBe('Fallback');
      expect(result.metadata.reasoning?.signature).toBe('fallback-sig');
    });
  });

  describe('getter methods', () => {
    it('getOutput should return accumulated output', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'text', text: 'Test' });

      expect(handler.getOutput()).toBe('Test');
    });

    it('getIsFunctionCall should return false by default', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      expect(handler.getIsFunctionCall()).toBe(false);
    });

    it('getTools should return undefined by default', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      expect(handler.getTools()).toBeUndefined();
    });

    it('getThinkingDuration should return undefined before reasoning ends', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking' });

      expect(handler.getThinkingDuration()).toBeUndefined();
    });

    it('getFinishType should return undefined before finish', () => {
      const callbacks = createMockCallbacks();
      const handler = new StreamingHandler(mockContext, callbacks);

      expect(handler.getFinishType()).toBeUndefined();
    });
  });
});
