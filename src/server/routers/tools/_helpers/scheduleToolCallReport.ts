import { CURRENT_VERSION } from '@lobechat/const';
import type {CallReportRequest} from '@lobehub/market-types';
import { after } from 'next/server';

import { DiscoverService } from '@/server/services/discover';

/**
 * Calculate byte size of object
 */
const calculateObjectSizeBytes = (obj: unknown): number => {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch {
    return 0;
  }
};

export interface ToolCallReportMeta {
  customPluginInfo?: {
    avatar?: string;
    description?: string;
    name?: string;
  };
  isCustomPlugin?: boolean;
  sessionId?: string;
  version?: string;
}

export interface ScheduleToolCallReportParams {
  /** Error code if call failed */
  errorCode?: string;
  /** Error message if call failed */
  errorMessage?: string;
  /** Plugin/tool identifier */
  identifier: string;
  /** Market access token for reporting */
  marketAccessToken?: string;
  /** MCP connection type */
  mcpType: string;
  /** Metadata for reporting */
  meta?: ToolCallReportMeta;
  /** Request payload for size calculation */
  requestPayload: unknown;
  /** Result for size calculation */
  result?: unknown;
  /** Start time of the call */
  startTime: number;
  /** Whether the call was successful */
  success: boolean;
  /** Whether telemetry is enabled */
  telemetryEnabled: boolean;
  /** Tool/method name */
  toolName: string;
}

/**
 * Schedule a tool call report to be sent after the response.
 * Uses Next.js after() to avoid blocking the response.
 */
export function scheduleToolCallReport(params: ScheduleToolCallReportParams): void {
  const {
    telemetryEnabled,
    marketAccessToken,
    startTime,
    success,
    errorCode,
    errorMessage,
    result,
    meta,
    identifier,
    toolName,
    mcpType,
    requestPayload,
  } = params;

  // Only report when telemetry is enabled and marketAccessToken exists
  if (!telemetryEnabled || !marketAccessToken) return;

  // Use Next.js after() to report after response is sent
  after(async () => {
    try {
      const callDurationMs = Date.now() - startTime;
      const requestSizeBytes = calculateObjectSizeBytes(requestPayload);
      const responseSizeBytes = success && result ? calculateObjectSizeBytes(result) : 0;

      const reportData: CallReportRequest = {
        callDurationMs,
        customPluginInfo: meta?.customPluginInfo,
        errorCode,
        errorMessage,
        identifier,
        isCustomPlugin: meta?.isCustomPlugin,
        metadata: {
          appVersion: CURRENT_VERSION,
          mcpType,
        },
        methodName: toolName,
        methodType: 'tool',
        requestSizeBytes,
        responseSizeBytes,
        sessionId: meta?.sessionId,
        success,
        version: meta?.version || 'unknown',
      };

      const discoverService = new DiscoverService({ accessToken: marketAccessToken });
      await discoverService.reportCall(reportData);
    } catch (reportError) {
      console.error('Failed to report tool call: %O', reportError);
    }
  });
}
