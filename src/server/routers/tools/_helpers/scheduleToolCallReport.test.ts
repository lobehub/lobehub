// @vitest-environment node
import { CURRENT_VERSION } from '@lobechat/const';
import { type CallReportRequest } from '@lobehub/market-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from '@/server/services/discover';

import {
  type ScheduleToolCallReportParams,
  scheduleToolCallReport,
} from './scheduleToolCallReport';

// Mock Next.js after() function
vi.mock('next/server', () => ({
  after: vi.fn((callback) => callback()),
}));

// Mock DiscoverService
vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn().mockImplementation(() => ({
    reportCall: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('scheduleToolCallReport', () => {
  const baseParams: ScheduleToolCallReportParams = {
    identifier: 'test-plugin',
    marketAccessToken: 'test-token',
    mcpType: 'stdio',
    requestPayload: { arg: 'value' },
    startTime: Date.now() - 1000,
    success: true,
    telemetryEnabled: true,
    toolName: 'testTool',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateObjectSizeBytes (via integration)', () => {
    it('should calculate byte size for simple objects', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const now = 1000;
      vi.setSystemTime(now);

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: { key: 'value' },
        result: { response: 'ok' },
        startTime: now - 500,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          requestSizeBytes: expect.any(Number),
          responseSizeBytes: expect.any(Number),
        }),
      );

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      // Simple object {"key":"value"} should be around 15 bytes
      expect(callArgs.requestSizeBytes).toBeGreaterThan(0);
      // Response {"response":"ok"} should be around 17 bytes
      expect(callArgs.responseSizeBytes).toBeGreaterThan(0);
    });

    it('should calculate byte size for complex nested objects', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const complexObject = {
        nested: {
          deep: {
            value: 'test',
            array: [1, 2, 3],
          },
        },
      };

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: complexObject,
        result: complexObject,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).toHaveBeenCalled();
      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBeGreaterThan(50);
      expect(callArgs.responseSizeBytes).toBeGreaterThan(50);
    });

    it('should handle empty objects', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: {},
        result: {},
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBe(2); // "{}"
      expect(callArgs.responseSizeBytes).toBe(2); // "{}"
    });

    it('should handle arrays', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: [1, 2, 3, 4, 5],
        result: ['a', 'b', 'c'],
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBeGreaterThan(0);
      expect(callArgs.responseSizeBytes).toBeGreaterThan(0);
    });

    it('should handle strings', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: 'test string',
        result: 'response string',
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBe(13); // "test string"
      expect(callArgs.responseSizeBytes).toBe(17); // "response string"
    });

    it('should handle numbers', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: 12345,
        result: 67890,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBe(5); // "12345"
      expect(callArgs.responseSizeBytes).toBe(5); // "67890"
    });

    it('should handle null and undefined', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: null,
        result: undefined,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.requestSizeBytes).toBe(4); // "null"
      // result is undefined, so responseSizeBytes should be 0 according to code logic
      expect(callArgs.responseSizeBytes).toBe(0);
    });

    it('should handle Unicode characters correctly', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: { text: '你好世界' },
        result: { emoji: '😀🎉' },
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      // Unicode characters take more bytes than ASCII
      expect(callArgs.requestSizeBytes).toBeGreaterThan(10);
      expect(callArgs.responseSizeBytes).toBeGreaterThan(10);
    });

    it('should return 0 for circular reference objects', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const circular: any = { a: 1 };
      circular.self = circular;

      scheduleToolCallReport({
        ...baseParams,
        requestPayload: circular,
        result: { ok: true },
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      // Circular reference should fail JSON.stringify and return 0
      expect(callArgs.requestSizeBytes).toBe(0);
      expect(callArgs.responseSizeBytes).toBeGreaterThan(0);
    });
  });

  describe('scheduleToolCallReport function', () => {
    it('should not report when telemetry is disabled', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        telemetryEnabled: false,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).not.toHaveBeenCalled();
    });

    it('should not report when marketAccessToken is missing', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        marketAccessToken: undefined,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).not.toHaveBeenCalled();
    });

    it('should not report when both telemetry disabled and no token', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        telemetryEnabled: false,
        marketAccessToken: undefined,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).not.toHaveBeenCalled();
    });

    it('should report successful tool call with all metadata', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const now = 2000;
      vi.setSystemTime(now);

      scheduleToolCallReport({
        ...baseParams,
        startTime: now - 1500,
        result: { data: 'response' },
        meta: {
          customPluginInfo: {
            avatar: 'http://avatar.url',
            description: 'Plugin description',
            name: 'Plugin Name',
          },
          isCustomPlugin: true,
          sessionId: 'session-123',
          version: '1.0.0',
        },
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).toHaveBeenCalledWith({
        callDurationMs: 1500,
        customPluginInfo: {
          avatar: 'http://avatar.url',
          description: 'Plugin description',
          name: 'Plugin Name',
        },
        errorCode: undefined,
        errorMessage: undefined,
        identifier: 'test-plugin',
        isCustomPlugin: true,
        metadata: {
          appVersion: CURRENT_VERSION,
          mcpType: 'stdio',
        },
        methodName: 'testTool',
        methodType: 'tool',
        requestSizeBytes: expect.any(Number),
        responseSizeBytes: expect.any(Number),
        sessionId: 'session-123',
        success: true,
        version: '1.0.0',
      });
    });

    it('should report failed tool call with error details', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const now = 3000;
      vi.setSystemTime(now);

      scheduleToolCallReport({
        ...baseParams,
        startTime: now - 2000,
        success: false,
        errorCode: 'ERR_TIMEOUT',
        errorMessage: 'Request timed out after 30 seconds',
        result: undefined,
      });

      await vi.runAllTimersAsync();

      expect(mockReportCall).toHaveBeenCalledWith({
        callDurationMs: 2000,
        customPluginInfo: undefined,
        errorCode: 'ERR_TIMEOUT',
        errorMessage: 'Request timed out after 30 seconds',
        identifier: 'test-plugin',
        isCustomPlugin: undefined,
        metadata: {
          appVersion: CURRENT_VERSION,
          mcpType: 'stdio',
        },
        methodName: 'testTool',
        methodType: 'tool',
        requestSizeBytes: expect.any(Number),
        responseSizeBytes: 0,
        sessionId: undefined,
        success: false,
        version: 'unknown',
      });
    });

    it('should use "unknown" as default version when not provided', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        meta: undefined,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.version).toBe('unknown');
    });

    it('should handle different mcpType values', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        mcpType: 'sse',
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.metadata?.mcpType).toBe('sse');
    });

    it('should set responseSizeBytes to 0 when success is false', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        success: false,
        result: { data: 'this should be ignored' },
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.responseSizeBytes).toBe(0);
    });

    it('should set responseSizeBytes to 0 when result is undefined', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        success: true,
        result: undefined,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.responseSizeBytes).toBe(0);
    });

    it('should catch and log errors during reporting', async () => {
      const mockReportCall = vi.fn().mockRejectedValue(new Error('Network error'));
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scheduleToolCallReport(baseParams);

      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to report tool call: %O',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should use Next.js after() to schedule reporting', async () => {
      const { after } = await import('next/server');

      scheduleToolCallReport(baseParams);

      expect(after).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should create DiscoverService with marketAccessToken', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        marketAccessToken: 'custom-token-123',
      });

      await vi.runAllTimersAsync();

      expect(DiscoverService).toHaveBeenCalledWith({ accessToken: 'custom-token-123' });
    });

    it('should calculate correct duration for very fast calls', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const now = 5000;
      vi.setSystemTime(now);

      scheduleToolCallReport({
        ...baseParams,
        startTime: now - 10,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.callDurationMs).toBe(10);
    });

    it('should calculate correct duration for slow calls', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      const now = 60000;
      vi.setSystemTime(now);

      scheduleToolCallReport({
        ...baseParams,
        startTime: now - 30000,
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.callDurationMs).toBe(30000);
    });

    it('should handle empty custom plugin info', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        meta: {
          customPluginInfo: {},
          isCustomPlugin: false,
        },
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.customPluginInfo).toEqual({});
      expect(callArgs.isCustomPlugin).toBe(false);
    });

    it('should handle partial custom plugin info', async () => {
      const mockReportCall = vi.fn().mockResolvedValue(undefined);
      (DiscoverService as any).mockImplementation(() => ({
        reportCall: mockReportCall,
      }));

      scheduleToolCallReport({
        ...baseParams,
        meta: {
          customPluginInfo: {
            name: 'Only Name',
          },
        },
      });

      await vi.runAllTimersAsync();

      const callArgs = mockReportCall.mock.calls[0][0] as CallReportRequest;
      expect(callArgs.customPluginInfo).toEqual({
        name: 'Only Name',
      });
    });
  });
});
