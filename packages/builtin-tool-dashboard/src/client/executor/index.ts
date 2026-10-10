import type {
  BuiltinServerRuntimeOutput,
  BuiltinToolContext,
  BuiltinToolResult,
  ToolAfterCallContext,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { dashboardService } from '@/services/dashboard';
import { useDashboardStore } from '@/store/dashboard';

import type { AddWidgetToDashboardState, DashboardApiNameType } from '../../types';
import { DashboardApiName, DashboardIdentifier } from '../../types';

const log = debug('lobe-dashboard:executor');

/** Calls that change a widget the Portal or a board may already show. */
const WIDGET_MUTATING_APIS = new Set<string>([
  DashboardApiName.dryRunWidget,
  DashboardApiName.requestPublish,
  DashboardApiName.updateWidgetDraft,
]);

/**
 * Client-runtime executor. Every call runs server-side through
 * `dashboard.runAgentTool` — the same `DashboardExecutionRuntime` and scoped
 * service the server agent runtime uses — so both runtimes stamp the same
 * ownership (agent / project / workspace) and draft provenance.
 */
class DashboardExecutor extends BaseExecutor<typeof DashboardApiName> {
  readonly identifier = DashboardIdentifier;
  protected readonly apiEnum = DashboardApiName;

  listDashboards = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.listDashboards, params, ctx);

  createWidgetDraft = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.createWidgetDraft, params, ctx);

  updateWidgetDraft = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.updateWidgetDraft, params, ctx);

  dryRunWidget = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.dryRunWidget, params, ctx);

  requestPublish = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.requestPublish, params, ctx);

  addWidgetToDashboard = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.addWidgetToDashboard, params, ctx);

  getWidgetRuns = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(DashboardApiName.getWidgetRuns, params, ctx);

  /**
   * The call changed dashboard data outside the dashboard store (server-side,
   * from either runtime): revalidate what an open Portal or board already shows —
   * e.g. the widget's "on boards" section after the agent places it.
   */
  onAfterCall = async ({ apiName, params, result }: ToolAfterCallContext) => {
    if (!result.success) return;
    const widgetId = (params as { widgetId?: unknown } | undefined)?.widgetId;
    if (typeof widgetId !== 'string') return;

    const store = useDashboardStore.getState();
    try {
      if (apiName === DashboardApiName.addWidgetToDashboard) {
        const state = result.state as Partial<AddWidgetToDashboardState> | undefined;
        await store.refreshWidgetPlacement(widgetId, state?.dashboardId);
      } else if (WIDGET_MUTATING_APIS.has(apiName)) {
        await store.refreshWidget(widgetId);
      }
    } catch (error) {
      log('refresh after %s failed: %o', apiName, error);
    }
  };

  private run = async (
    apiName: DashboardApiNameType,
    params: unknown,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('%s params=%o', apiName, params);
      const output = await dashboardService.runAgentTool(apiName, params, {
        agentId: ctx?.agentId,
        messageId: ctx?.messageId,
        operationId: ctx?.operationId,
        topicId: ctx?.topicId ?? undefined,
      });
      const result = this.toResult(output);
      // The client runtime never fires `onAfterCall` (only streamed gateway
      // results do), so sync open views here too.
      await this.onAfterCall({ apiName, identifier: this.identifier, params, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Failed to run ${apiName}: ${message}`,
        error: { message, type: 'DashboardToolFailed' },
        success: false,
      };
    }
  };

  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errorMessage =
      typeof output.error?.message === 'string' ? output.error.message : undefined;
    const content = output.content || errorMessage || 'Tool execution failed';
    if (!output.success) {
      return {
        content,
        error: { body: output.error, message: errorMessage ?? content, type: 'PluginServerError' },
        state: output.state,
        success: false,
      };
    }
    return { content, state: output.state, success: true };
  }
}

export const dashboardExecutor = new DashboardExecutor();
