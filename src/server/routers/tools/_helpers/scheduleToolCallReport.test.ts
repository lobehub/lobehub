// @vitest-environment node
import { CURRENT_VERSION } from '@lobechat/const';
import { after } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from '@/server/services/discover';

import {
  type ScheduleToolCallReportParams,
  scheduleToolCallReport,
} from './scheduleToolCallReport';

// Mock dependencies
vi.mock('next/server', () => ({
  after: vi.fn((callback) => {
    // Execute callback immediately in tests
    callback();
  }),
}));

vi.mock('@/server/services/discover');

describe('scheduleToolCallReport', () => {
  let mockDiscoverService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup DiscoverService mock
    mockDiscoverService = {
      reportCall: vi.fn().mockResolvedValue(undefined),
    };

    (DiscoverService as any).mockImplementation(() => mockDiscoverService);
  });

  describe('Basic functionality', () => {
    it('should schedule a report when telemetry is enabled and token exists', async () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: { input: 'test' },
        result: { output: 'success' },
        startTime: Date.now() - 1000,
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(after).toHaveBeenCalled();
      expect(DiscoverService).toHaveBeenCalledWith({ accessToken: 'test-token' });
      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'test-plugin',
          methodName: 'testTool',
          methodType: 'tool',
          success: true,
        }),
      );
    });

    it('should include metadata with appVersion and mcpType', async () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'sse',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            appVersion: CURRENT_VERSION,
            mcpType: 'sse',
          },
        }),
      );
    });

    it('should calculate callDurationMs correctly', async () => {
      const startTime = Date.now() - 2500; // 2.5 seconds ago
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime,
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.callDurationMs).toBeGreaterThanOrEqual(2500);
      expect(callArgs.callDurationMs).toBeLessThan(3000);
    });
  });

  describe('Conditional reporting', () => {
    it('should not report when telemetry is disabled', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: false,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(after).not.toHaveBeenCalled();
      expect(mockDiscoverService.reportCall).not.toHaveBeenCalled();
    });

    it('should not report when marketAccessToken is missing', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(after).not.toHaveBeenCalled();
      expect(mockDiscoverService.reportCall).not.toHaveBeenCalled();
    });

    it('should not report when marketAccessToken is empty string', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: '',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(after).not.toHaveBeenCalled();
      expect(mockDiscoverService.reportCall).not.toHaveBeenCalled();
    });
  });

  describe('Size calculation', () => {
    it('should calculate request size from payload', () => {
      const requestPayload = { test: 'data', nested: { value: 123 } };
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload,
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.requestSizeBytes).toBeGreaterThan(0);
      // JSON.stringify(requestPayload) should have some size
      expect(callArgs.requestSizeBytes).toBe(
        new TextEncoder().encode(JSON.stringify(requestPayload)).length,
      );
    });

    it('should calculate response size when success is true', () => {
      const result = { response: 'data', status: 'ok' };
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        result,
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.responseSizeBytes).toBeGreaterThan(0);
      expect(callArgs.responseSizeBytes).toBe(
        new TextEncoder().encode(JSON.stringify(result)).length,
      );
    });

    it('should set response size to 0 when success is false', () => {
      const params: ScheduleToolCallReportParams = {
        errorCode: 'ERROR_CODE',
        errorMessage: 'Something went wrong',
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        result: { data: 'should be ignored' },
        startTime: Date.now(),
        success: false,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.responseSizeBytes).toBe(0);
    });

    it('should set response size to 0 when result is missing', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.responseSizeBytes).toBe(0);
    });

    it('should handle non-serializable objects gracefully', () => {
      const circularRef: any = { a: 1 };
      circularRef.self = circularRef; // Create circular reference

      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: circularRef,
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      // Should return 0 for non-serializable objects
      expect(callArgs.requestSizeBytes).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should include error information when call fails', () => {
      const params: ScheduleToolCallReportParams = {
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Failed to connect to service',
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: false,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Failed to connect to service',
          success: false,
        }),
      );
    });

    it('should handle missing error fields gracefully', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: false,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: undefined,
          errorMessage: undefined,
          success: false,
        }),
      );
    });

    it('should catch and log errors from reportCall', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDiscoverService.reportCall.mockRejectedValue(new Error('Network failure'));

      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to report tool call: %O',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Metadata handling', () => {
    it('should include custom plugin info when provided', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'custom-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        meta: {
          customPluginInfo: {
            avatar: 'https://example.com/avatar.png',
            description: 'Custom plugin description',
            name: 'Custom Plugin',
          },
          isCustomPlugin: true,
        },
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          customPluginInfo: {
            avatar: 'https://example.com/avatar.png',
            description: 'Custom plugin description',
            name: 'Custom Plugin',
          },
          isCustomPlugin: true,
        }),
      );
    });

    it('should include sessionId when provided', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        meta: {
          sessionId: 'session-123',
        },
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123',
        }),
      );
    });

    it('should use provided version or default to "unknown"', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        meta: {
          version: '1.2.3',
        },
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '1.2.3',
        }),
      );
    });

    it('should default version to "unknown" when not provided', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'unknown',
        }),
      );
    });
  });

  describe('Complete data structure', () => {
    it('should send complete report with all fields', () => {
      const params: ScheduleToolCallReportParams = {
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timed out',
        identifier: 'comprehensive-plugin',
        marketAccessToken: 'test-token-123',
        mcpType: 'sse',
        meta: {
          customPluginInfo: {
            avatar: 'https://example.com/icon.png',
            description: 'A comprehensive test plugin',
            name: 'Test Plugin',
          },
          isCustomPlugin: true,
          sessionId: 'sess-456',
          version: '2.0.0',
        },
        requestPayload: { action: 'process', data: [1, 2, 3] },
        result: { status: 'partial', processed: 2 },
        startTime: Date.now() - 5000,
        success: false,
        telemetryEnabled: true,
        toolName: 'processData',
      };

      scheduleToolCallReport(params);

      expect(mockDiscoverService.reportCall).toHaveBeenCalledWith({
        callDurationMs: expect.any(Number),
        customPluginInfo: {
          avatar: 'https://example.com/icon.png',
          description: 'A comprehensive test plugin',
          name: 'Test Plugin',
        },
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timed out',
        identifier: 'comprehensive-plugin',
        isCustomPlugin: true,
        metadata: {
          appVersion: CURRENT_VERSION,
          mcpType: 'sse',
        },
        methodName: 'processData',
        methodType: 'tool',
        requestSizeBytes: expect.any(Number),
        responseSizeBytes: 0, // 0 because success is false
        sessionId: 'sess-456',
        success: false,
        version: '2.0.0',
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty request payload', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: {},
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.requestSizeBytes).toBe(new TextEncoder().encode('{}').length);
    });

    it('should handle null request payload', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: null,
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.requestSizeBytes).toBe(new TextEncoder().encode('null').length);
    });

    it('should handle array request payload', () => {
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: [1, 2, 3, 4, 5],
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.requestSizeBytes).toBeGreaterThan(0);
    });

    it('should handle large payloads', () => {
      const largePayload = {
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
      };
      const params: ScheduleToolCallReportParams = {
        identifier: 'test-plugin',
        marketAccessToken: 'test-token',
        mcpType: 'stdio',
        requestPayload: largePayload,
        result: largePayload,
        startTime: Date.now(),
        success: true,
        telemetryEnabled: true,
        toolName: 'testTool',
      };

      scheduleToolCallReport(params);

      const callArgs = mockDiscoverService.reportCall.mock.calls[0][0];
      expect(callArgs.requestSizeBytes).toBeGreaterThan(10000);
      expect(callArgs.responseSizeBytes).toBeGreaterThan(10000);
    });

    it('should handle different MCP types', () => {
      const mcpTypes = ['stdio', 'sse', 'http', 'websocket'];

      mcpTypes.forEach((mcpType) => {
        vi.clearAllMocks();

        const params: ScheduleToolCallReportParams = {
          identifier: 'test-plugin',
          marketAccessToken: 'test-token',
          mcpType,
          requestPayload: {},
          startTime: Date.now(),
          success: true,
          telemetryEnabled: true,
          toolName: 'testTool',
        };

        scheduleToolCallReport(params);

        expect(mockDiscoverService.reportCall).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              mcpType,
            }),
          }),
        );
      });
    });
  });
});
