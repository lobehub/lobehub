import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardService } from '@/services/dashboard';

import { DashboardApiName } from '../../types';
import { dashboardExecutor } from './index';

const refreshWidget = vi.fn();
const refreshWidgetPlacement = vi.fn();

vi.mock('@/services/dashboard', () => ({
  dashboardService: { runAgentTool: vi.fn() },
}));
vi.mock('@/store/dashboard', () => ({
  useDashboardStore: { getState: () => ({ refreshWidget, refreshWidgetPlacement }) },
}));

beforeEach(() => {
  vi.mocked(dashboardService.runAgentTool).mockReset();
  refreshWidget.mockReset();
  refreshWidgetPlacement.mockReset();
});

describe('dashboardExecutor', () => {
  it('exposes every API', () => {
    for (const api of Object.values(DashboardApiName))
      expect(dashboardExecutor.hasApi(api)).toBe(true);
  });

  it('runs the call server-side with the conversation context', async () => {
    vi.mocked(dashboardService.runAgentTool).mockResolvedValue({
      content: 'Dry run succeeded',
      state: { runId: 'r1' },
      success: true,
    });

    const result = await dashboardExecutor.invoke(
      DashboardApiName.dryRunWidget,
      { widgetId: 'w1' },
      { agentId: 'agt_1', messageId: 'msg_1', operationId: 'op_1', topicId: 'tpc_1' },
    );

    expect(dashboardService.runAgentTool).toHaveBeenCalledWith(
      'dryRunWidget',
      { widgetId: 'w1' },
      { agentId: 'agt_1', messageId: 'msg_1', operationId: 'op_1', topicId: 'tpc_1' },
    );
    expect(result).toEqual({ content: 'Dry run succeeded', state: { runId: 'r1' }, success: true });
  });

  it('keeps content and state on a refused call', async () => {
    vi.mocked(dashboardService.runAgentTool).mockResolvedValue({
      content: 'Failed to publish widget: dry-run it first',
      error: { message: 'dry-run it first' },
      success: false,
    });

    const result = await dashboardExecutor.invoke(
      DashboardApiName.requestPublish,
      { widgetId: 'w1' },
      { messageId: 'msg_1' },
    );

    expect(result).toMatchObject({
      content: 'Failed to publish widget: dry-run it first',
      error: { message: 'dry-run it first', type: 'PluginServerError' },
      success: false,
    });
  });

  it('turns a transport failure into a readable result', async () => {
    vi.mocked(dashboardService.runAgentTool).mockRejectedValue(new Error('UNAUTHORIZED'));
    const result = await dashboardExecutor.invoke(
      DashboardApiName.listDashboards,
      {},
      { messageId: 'msg_1' },
    );
    expect(result).toMatchObject({
      content: 'Failed to run listDashboards: UNAUTHORIZED',
      success: false,
    });
  });

  it('syncs open views after a call the client runtime ran', async () => {
    vi.mocked(dashboardService.runAgentTool).mockResolvedValue({
      content: 'Placed widget w1 on "Open-source health".',
      state: { createdDashboard: false, dashboardId: 'd1', widgetId: 'w1' },
      success: true,
    });

    await dashboardExecutor.invoke(
      DashboardApiName.addWidgetToDashboard,
      { dashboardId: 'd1', widgetId: 'w1' },
      { messageId: 'msg_1', topicId: 'tpc_1' },
    );

    expect(refreshWidgetPlacement).toHaveBeenCalledWith('w1', 'd1');
  });

  describe('onAfterCall', () => {
    const after = (apiName: string, params: unknown, result: Record<string, unknown>) =>
      dashboardExecutor.onAfterCall({
        apiName,
        identifier: 'lobe-dashboard',
        params,
        result: { content: '', success: true, ...result },
      });

    it('syncs the widget placement the agent made server-side', async () => {
      await after(
        DashboardApiName.addWidgetToDashboard,
        { newDashboardTitle: 'Open-source health', widgetId: 'w1' },
        { state: { createdDashboard: true, dashboardId: 'd1', widgetId: 'w1' } },
      );
      expect(refreshWidgetPlacement).toHaveBeenCalledWith('w1', 'd1');
    });

    it('refreshes a widget the agent changed', async () => {
      await after(DashboardApiName.requestPublish, { widgetId: 'w1' }, {});
      expect(refreshWidget).toHaveBeenCalledWith('w1');
    });

    it('leaves caches alone for failed and read-only calls', async () => {
      await after(DashboardApiName.addWidgetToDashboard, { widgetId: 'w1' }, { success: false });
      await after(DashboardApiName.getWidgetRuns, { widgetId: 'w1' }, {});
      expect(refreshWidgetPlacement).not.toHaveBeenCalled();
      expect(refreshWidget).not.toHaveBeenCalled();
    });
  });
});
