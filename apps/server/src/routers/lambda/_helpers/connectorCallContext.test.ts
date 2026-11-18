import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkTelemetryEnabled } from '@/libs/trpc/lambda/middleware';
import { scheduleToolCallReport } from '@/server/routers/tools/_helpers/scheduleToolCallReport';

import {
  resolveRequestToolCallReporter,
  withRequestConnectorCallers,
} from './connectorCallContext';

vi.mock('@/libs/trpc/lambda/middleware', () => ({ checkTelemetryEnabled: vi.fn() }));
vi.mock('@/server/routers/tools/_helpers/scheduleToolCallReport', () => ({
  scheduleToolCallReport: vi.fn(),
}));
vi.mock('./cloudMcpCaller', () => ({ resolveRequestCloudMcpCaller: vi.fn() }));
vi.mock('./requestFileService', () => ({ resolveRequestFileService: vi.fn() }));

const ctx = { marketAccessToken: 'mp-token', serverDB: {} as never, userId: 'user-1' };
const report = {
  identifier: 'notes-mcp',
  mcpType: 'http',
  meta: { sessionId: 'tpc_1', version: '1.2.0' },
  requestPayload: '{}',
  startTime: 1,
  success: true,
  toolName: 'search',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkTelemetryEnabled).mockResolvedValue({ telemetryEnabled: true });
});

describe('resolveRequestToolCallReporter', () => {
  it("reports a call with the request's Market token while telemetry is on", async () => {
    const reporter = await resolveRequestToolCallReporter(ctx);

    reporter!(report);

    expect(scheduleToolCallReport).toHaveBeenCalledWith({
      ...report,
      marketAccessToken: 'mp-token',
      telemetryEnabled: true,
    });
  });

  it('reports nothing once the user turned telemetry off', async () => {
    vi.mocked(checkTelemetryEnabled).mockResolvedValue({ telemetryEnabled: false });

    await expect(resolveRequestToolCallReporter(ctx)).resolves.toBeUndefined();
  });

  it('reports nothing without a Market token, and does not read the setting', async () => {
    await expect(
      resolveRequestToolCallReporter({ ...ctx, marketAccessToken: undefined }),
    ).resolves.toBeUndefined();
    expect(checkTelemetryEnabled).not.toHaveBeenCalled();
  });
});

describe('withRequestConnectorCallers', () => {
  it('keeps the request context and resolves nothing up front', () => {
    const callers = withRequestConnectorCallers(ctx);

    expect(callers).toMatchObject(ctx);
    expect(callers.resolveToolCallReporter).toBeTypeOf('function');
    expect(checkTelemetryEnabled).not.toHaveBeenCalled();
  });
});
