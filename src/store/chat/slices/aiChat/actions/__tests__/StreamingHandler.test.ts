import { describe, expect, it, vi } from 'vitest';

import { StreamingHandler } from '../StreamingHandler';
import type { StreamChunk, StreamingCallbacks, StreamingContext } from '../types/streaming';

// Helper to create a mock streaming context
const createContext = (overrides: Partial<StreamingContext> = {}): StreamingContext => ({
  agentId: 'test-agent',
  messageId: 'test-message',
  operationId: 'test-op',
  ...overrides,
});

// Helper to create mock callbacks
const createCallbacks = (overrides: Partial<StreamingCallbacks> = {}): StreamingCallbacks => ({
  onContentUpdate: vi.fn(),
  onGroundingUpdate: vi.fn(),
  onImagesUpdate: vi.fn(),
  onReasoningComplete: vi.fn(),
  onReasoningStart: vi.fn().mockReturnValue('reasoning-op-id'),
  onReasoningUpdate: vi.fn(),
  onToolCallsUpdate: vi.fn(),
  toggleToolCallingStreaming: vi.fn(),
  transformToolCalls: vi.fn().mockReturnValue([]),
  uploadBase64Image: vi
    .fn()
    .mockResolvedValue({ id: 'img-id', url: 'https://uploaded.url/img.png' }),
  ...overrides,
});

describe('StreamingHandler', () => {
  describe('content_part image handling', () => {
    it('should pass contentMetadata with isMultimodal when content_part image chunks are received', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      // Send a text content_part
      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'Here is an image: ',
      });

      // Send an image content_part
      handler.handleChunk({
        type: 'content_part',
        partType: 'image',
        content: 'base64imagedata',
        mimeType: 'image/png',
      });

      // The last onContentUpdate call should include contentMetadata
      const lastCall = (callbacks.onContentUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      expect(lastCall).toBeDefined();

      const [content, reasoning, contentMetadata] = lastCall!;
      expect(content).toBe('Here is an image: ');
      expect(contentMetadata).toBeDefined();
      expect(contentMetadata.isMultimodal).toBe(true);
      expect(contentMetadata.tempDisplayContent).toBeDefined();
      // tempDisplayContent should be a serialized JSON string containing the parts
      const parsed = JSON.parse(contentMetadata.tempDisplayContent);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ type: 'text', text: 'Here is an image: ' });
      expect(parsed[1]).toEqual(
        expect.objectContaining({
          type: 'image',
          image: expect.stringContaining('data:image/png;base64,'),
        }),
      );
    });

    it('should NOT pass contentMetadata when only text content_part chunks are received', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'Hello ',
      });
      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'world',
      });

      const lastCall = (callbacks.onContentUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      expect(lastCall).toBeDefined();

      const [content, _reasoning, contentMetadata] = lastCall!;
      expect(content).toBe('Hello world');
      // No contentMetadata when there are no images
      expect(contentMetadata).toBeUndefined();
    });

    it('should include isMultimodal in final result metadata when content has images', async () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      // Send mixed content
      handler.handleChunk({
        type: 'content_part',
        partType: 'text',
        content: 'A cat: ',
      });
      handler.handleChunk({
        type: 'content_part',
        partType: 'image',
        content: 'base64catimage',
        mimeType: 'image/jpeg',
      });

      const result = await handler.handleFinish({});

      expect(result.metadata.isMultimodal).toBe(true);
      // Content should be serialized JSON containing text + image parts
      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('text');
      expect(parsed[1].type).toBe('image');
    });

    it('should NOT include isMultimodal in final result when only text content', async () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({ type: 'text', text: 'Hello world' });

      const result = await handler.handleFinish({});

      expect(result.metadata.isMultimodal).toBeUndefined();
      expect(result.content).toBe('Hello world');
    });
  });

  describe('text chunk handling', () => {
    it('should accumulate text chunks and notify via onContentUpdate', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({ type: 'text', text: 'Hello' });
      handler.handleChunk({ type: 'text', text: ' World' });

      expect(callbacks.onContentUpdate).toHaveBeenCalledTimes(2);
      expect(handler.getOutput()).toBe('Hello World');
    });
  });

  describe('reasoning chunk handling', () => {
    it('should track reasoning content and start/end timing', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      // Reasoning starts
      handler.handleChunk({ type: 'reasoning', text: 'Let me think...' });
      expect(callbacks.onReasoningStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onReasoningUpdate).toHaveBeenCalledWith({ content: 'Let me think...' });

      // Text ends reasoning
      handler.handleChunk({ type: 'text', text: 'Answer' });
      expect(handler.getThinkingDuration()).toBeDefined();
      expect(handler.getThinkingDuration()).toBeGreaterThanOrEqual(0);
    });

    it('should include reasoning in final result with signature', async () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({ type: 'reasoning', text: 'Thinking' });
      handler.handleChunk({ type: 'text', text: 'Answer' });

      const result = await handler.handleFinish({
        reasoning: { content: 'Thinking', signature: 'test-sig' },
      });

      expect(result.metadata.reasoning).toBeDefined();
      expect(result.metadata.reasoning?.content).toBe('Thinking');
      expect(result.metadata.reasoning?.signature).toBe('test-sig');
      // Duration may be 0 in fast tests (which becomes undefined due to `0 && ...` check)
      // So we just verify it's a number or undefined
      expect(
        result.metadata.reasoning?.duration === undefined ||
          typeof result.metadata.reasoning?.duration === 'number',
      ).toBe(true);
    });
  });

  describe('reasoning_part with images', () => {
    it('should handle reasoning_part image chunks and report isMultimodal', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'text',
        content: 'Thinking about image: ',
      });
      handler.handleChunk({
        type: 'reasoning_part',
        partType: 'image',
        content: 'base64data',
        mimeType: 'image/png',
      });

      const lastCall = (callbacks.onReasoningUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0].isMultimodal).toBe(true);
      expect(lastCall![0].tempDisplayContent).toBeDefined();
    });
  });

  describe('tool_calls handling', () => {
    it('should mark as function call when tool_calls chunk is received', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'tool_calls',
        tool_calls: [
          { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
        ],
        isAnimationActives: [true],
      });

      expect(handler.getIsFunctionCall()).toBe(true);
      expect(callbacks.toggleToolCallingStreaming).toHaveBeenCalledWith('test-message', [true]);
    });
  });

  describe('handleFinish with tool calls', () => {
    it('should process final tool calls and set isFunctionCall', async () => {
      const callbacks = createCallbacks({
        transformToolCalls: vi.fn().mockReturnValue([{ identifier: 'test', arguments: '{}' }]),
      });
      const handler = new StreamingHandler(createContext(), callbacks);

      const result = await handler.handleFinish({
        toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'test', arguments: '' } }],
      });

      expect(result.isFunctionCall).toBe(true);
      expect(result.tools).toBeDefined();
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('base64_image handling', () => {
    it('should dispatch images immediately and upload async', async () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'base64_image',
        image: { id: 'img-1', data: 'base64data' },
        images: [{ id: 'img-1', data: 'base64data' }],
      });

      expect(callbacks.onImagesUpdate).toHaveBeenCalledWith([
        { alt: 'img-1', id: 'img-1', url: 'base64data' },
      ]);

      // After finish, uploaded images should be in the result
      const result = await handler.handleFinish({});
      expect(result.metadata.imageList).toBeDefined();
      expect(result.metadata.imageList).toHaveLength(1);
      expect(result.metadata.imageList![0].url).toBe('https://uploaded.url/img.png');
    });
  });

  describe('grounding handling', () => {
    it('should forward citations to onGroundingUpdate', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'grounding',
        grounding: {
          citations: [{ url: 'https://example.com', title: 'Example' }],
          searchQueries: ['query'],
        },
      } as any);

      expect(callbacks.onGroundingUpdate).toHaveBeenCalledWith({
        citations: [{ url: 'https://example.com', title: 'Example' }],
        searchQueries: ['query'],
      });
    });

    it('should skip grounding when no citations', () => {
      const callbacks = createCallbacks();
      const handler = new StreamingHandler(createContext(), callbacks);

      handler.handleChunk({
        type: 'grounding',
        grounding: { citations: [], searchQueries: [] },
      } as any);

      expect(callbacks.onGroundingUpdate).not.toHaveBeenCalled();
    });
  });
});
