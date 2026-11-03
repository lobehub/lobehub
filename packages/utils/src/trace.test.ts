import { LOBE_CHAT_TRACE_HEADER, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { createTraceHeader, getTraceId, getTracePayload } from './trace';

describe('trace utilities', () => {
  describe('getTracePayload', () => {
    it('should extract and decode trace payload from request headers', () => {
      const payload = {
        traceId: '123-456-789',
        sessionId: 'session-abc',
        timestamp: 1234567890,
      };

      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: encoded,
        },
      });

      const result = getTracePayload(mockRequest);

      expect(result).toEqual(payload);
    });

    it('should return undefined when trace header is not present', () => {
      const mockRequest = new Request('http://localhost');

      const result = getTracePayload(mockRequest);

      expect(result).toBeUndefined();
    });

    it('should handle empty trace header', () => {
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: '',
        },
      });

      const result = getTracePayload(mockRequest);

      expect(result).toBeUndefined();
    });

    it('should decode complex payload with nested objects', () => {
      const payload = {
        traceId: 'trace-123',
        metadata: {
          user: { id: 'user-1', role: 'admin' },
          context: { env: 'production', region: 'us-west-2' },
        },
        tags: ['important', 'production'],
      };

      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: encoded,
        },
      });

      const result = getTracePayload(mockRequest);

      expect(result).toEqual(payload);
    });

    it('should handle payload with special characters', () => {
      const payload = {
        traceId: 'trace-with-特殊字符-🔥',
        message: 'Test with émojis 😀',
      };

      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: encoded,
        },
      });

      const result = getTracePayload(mockRequest);

      expect(result).toEqual(payload);
    });

    it('should handle payload with null values', () => {
      const payload = {
        traceId: 'trace-123',
        optionalField: null,
        anotherField: undefined,
      };

      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: encoded,
        },
      });

      const result = getTracePayload(mockRequest);

      // Note: undefined values are removed during JSON.stringify
      expect(result).toEqual({
        traceId: 'trace-123',
        optionalField: null,
      });
    });

    it('should handle numeric and boolean values in payload', () => {
      const payload = {
        traceId: 'trace-123',
        count: 42,
        isActive: true,
        ratio: 3.14159,
        isDisabled: false,
      };

      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const mockRequest = new Request('http://localhost', {
        headers: {
          [LOBE_CHAT_TRACE_HEADER]: encoded,
        },
      });

      const result = getTracePayload(mockRequest);

      expect(result).toEqual(payload);
    });
  });

  describe('getTraceId', () => {
    it('should extract trace ID from response headers', () => {
      const traceId = 'trace-xyz-789';
      const mockResponse = new Response(null, {
        headers: {
          [LOBE_CHAT_TRACE_ID]: traceId,
        },
      });

      const result = getTraceId(mockResponse);

      expect(result).toBe(traceId);
    });

    it('should return null when trace ID header is not present', () => {
      const mockResponse = new Response(null);

      const result = getTraceId(mockResponse);

      expect(result).toBeNull();
    });

    it('should handle empty trace ID', () => {
      const mockResponse = new Response(null, {
        headers: {
          [LOBE_CHAT_TRACE_ID]: '',
        },
      });

      const result = getTraceId(mockResponse);

      expect(result).toBe('');
    });

    it('should handle trace ID with special characters', () => {
      const traceId = 'trace-123-abc-特殊-🔥';
      const mockResponse = new Response(null, {
        headers: {
          [LOBE_CHAT_TRACE_ID]: traceId,
        },
      });

      const result = getTraceId(mockResponse);

      expect(result).toBe(traceId);
    });

    it('should handle UUID-formatted trace IDs', () => {
      const traceId = '550e8400-e29b-41d4-a716-446655440000';
      const mockResponse = new Response(null, {
        headers: {
          [LOBE_CHAT_TRACE_ID]: traceId,
        },
      });

      const result = getTraceId(mockResponse);

      expect(result).toBe(traceId);
    });
  });

  describe('createTraceHeader', () => {
    it('should create a base64-encoded trace header from payload', () => {
      const payload = {
        traceId: 'trace-123',
        sessionId: 'session-456',
        timestamp: 1234567890,
      };

      const result = createTraceHeader(payload);

      expect(result).toHaveProperty(LOBE_CHAT_TRACE_HEADER);
      expect(typeof result[LOBE_CHAT_TRACE_HEADER]).toBe('string');

      // Verify it's valid base64
      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should create header for empty payload object', () => {
      const payload = {};

      const result = createTraceHeader(payload);

      expect(result).toHaveProperty(LOBE_CHAT_TRACE_HEADER);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual({});
    });

    it('should handle payload with nested objects', () => {
      const payload = {
        traceId: 'trace-123',
        metadata: {
          user: { id: 'user-1', name: 'John' },
          context: { env: 'prod' },
        },
      };

      const result = createTraceHeader(payload);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should handle payload with arrays', () => {
      const payload = {
        traceId: 'trace-123',
        tags: ['tag1', 'tag2', 'tag3'],
        values: [1, 2, 3, 4, 5],
      };

      const result = createTraceHeader(payload);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should handle payload with Unicode characters', () => {
      const payload = {
        traceId: 'trace-特殊-🔥',
        message: 'Hello 世界 😀',
        description: 'Тест тест',
      };

      const result = createTraceHeader(payload);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should handle payload with null values', () => {
      const payload = {
        traceId: 'trace-123',
        optionalField: null,
      };

      const result = createTraceHeader(payload);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should handle payload with boolean and numeric values', () => {
      const payload = {
        traceId: 'trace-123',
        count: 42,
        isActive: true,
        ratio: 3.14,
        isDisabled: false,
      };

      const result = createTraceHeader(payload);

      const decoded = Buffer.from(result[LOBE_CHAT_TRACE_HEADER], 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('should create header that works with getTracePayload', () => {
      const payload = {
        traceId: 'trace-round-trip',
        sessionId: 'session-test',
        timestamp: Date.now(),
      };

      const header = createTraceHeader(payload);
      const mockRequest = new Request('http://localhost', {
        headers: header,
      });

      const extractedPayload = getTracePayload(mockRequest);

      expect(extractedPayload).toEqual(payload);
    });
  });

  describe('round-trip encoding and decoding', () => {
    it('should correctly encode and decode simple payload', () => {
      const originalPayload = {
        traceId: 'test-123',
        data: 'test-data',
      };

      const header = createTraceHeader(originalPayload);
      const mockRequest = new Request('http://localhost', { headers: header });
      const decodedPayload = getTracePayload(mockRequest);

      expect(decodedPayload).toEqual(originalPayload);
    });

    it('should correctly encode and decode complex payload', () => {
      const originalPayload = {
        traceId: 'complex-trace',
        metadata: {
          user: { id: 'usr-123', roles: ['admin', 'user'] },
          timestamps: { created: 1234567890, updated: 1234567900 },
        },
        tags: ['production', 'critical'],
        metrics: { duration: 123.45, count: 10 },
        flags: { enabled: true, debug: false },
      };

      const header = createTraceHeader(originalPayload);
      const mockRequest = new Request('http://localhost', { headers: header });
      const decodedPayload = getTracePayload(mockRequest);

      expect(decodedPayload).toEqual(originalPayload);
    });

    it('should preserve data types through encoding and decoding', () => {
      const originalPayload = {
        traceId: 'trace-types-test',
        sessionId: 'session-123',
        userId: 'user-456',
        topicId: 'topic-789',
        observationId: 'obs-abc',
        enabled: true,
        tags: ['tag1', 'tag2', 'tag3'],
      };

      const header = createTraceHeader(originalPayload);
      const mockRequest = new Request('http://localhost', { headers: header });
      const decodedPayload = getTracePayload(mockRequest);

      expect(decodedPayload).toEqual(originalPayload);
    });
  });
});
