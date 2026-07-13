import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type {
  BrowserClickArgs,
  BrowserFillArgs,
  BrowserNavigateArgs,
  BrowserPressArgs,
  BrowserScrollArgs,
} from '../../types';
import { BrowserIdentifier } from '../../types';

const BrowserApiEnum = {
  click: 'click' as const,
  fill: 'fill' as const,
  navigate: 'navigate' as const,
  press: 'press' as const,
  readPage: 'readPage' as const,
  screenshot: 'screenshot' as const,
  scroll: 'scroll' as const,
  snapshot: 'snapshot' as const,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Browser Tool Executor (client / desktop only)
 *
 * Drives the in-app browser through the Electron IPC control gateway. Pages are
 * owned by the main process and keyed by session (`agent:<agentId>`), so every
 * agent drives its own page whether or not the user is watching it — an agent
 * running in the background never touches the page in front of the user.
 */
class BrowserExecutor extends BaseExecutor<typeof BrowserApiEnum> {
  readonly identifier = BrowserIdentifier;
  protected readonly apiEnum = BrowserApiEnum;

  /**
   * Every execution path funnels through this executor (local runtime, the
   * DesktopBrowserGatewayBridge for cloud runs, and the CC MCP bridge), so a
   * single Labs-toggle gate here covers them all: with the in-app browser lab
   * off, the sidebar tab is hidden and driving it would be invisible to the
   * user.
   */
  private async labDisabledFailure(): Promise<BuiltinToolResult | undefined> {
    const [{ useUserStore }, { labPreferSelectors }] = await Promise.all([
      import('@/store/user'),
      import('@/store/user/selectors'),
    ]);
    if (labPreferSelectors.enableInAppBrowser(useUserStore.getState())) return undefined;
    return this.failure(
      'The in-app browser is disabled. Ask the user to enable "In-App Browser" under Settings → Advanced → Labs, then retry.',
    );
  }

  navigate = async (params: BrowserNavigateArgs, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      const sessionId = this.sessionIdOf(ctx);
      const { electronBrowserSidebarService } = await import('@/services/electron/browserSidebar');

      // The main process creates the page on demand, so there is nothing to wait
      // for and no UI to open first — a background agent navigates its own page.
      await this.revealBrowserTab(ctx);
      const result = await electronBrowserSidebarService.navigate({ sessionId, url: params.url });
      if (!result.success) return this.failure(result.error ?? 'Navigation failed');

      // Let the page settle before reporting where we landed.
      await this.waitForLoad(sessionId);
      const next = await electronBrowserSidebarService.getState({ sessionId });
      return this.success(`Opened ${next.url}${next.title ? ` — "${next.title}"` : ''}`, {
        title: next.title,
        url: next.url,
      });
    } catch (error) {
      return this.errorResult(error);
    }
  };

  snapshot = async (_params: object, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.snapshot({
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success || !result.snapshot)
        return this.failure(result.error ?? 'Snapshot failed');

      const header = `Page: ${result.title ?? ''} (${result.url ?? ''})`;
      return this.success(`${header}\n${result.snapshot}`, {
        snapshot: result.snapshot,
        title: result.title,
        url: result.url,
      });
    } catch (error) {
      return this.errorResult(error);
    }
  };

  click = async (params: BrowserClickArgs, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      await this.revealBrowserTab(ctx);
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.click({
        ref: params.ref,
        sessionId: this.sessionIdOf(ctx),
        x: params.x,
        y: params.y,
      });
      if (!result.success) return this.failure(result.error ?? 'Click failed');

      return this.success(
        `Clicked${params.ref ? ` ${params.ref}` : ''}. Now at ${result.url}${result.title ? ` — "${result.title}"` : ''}. Take a new snapshot if the page changed.`,
        { title: result.title, url: result.url },
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  fill = async (params: BrowserFillArgs, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      await this.revealBrowserTab(ctx);
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.fill({
        ref: params.ref,
        sessionId: this.sessionIdOf(ctx),
        submit: params.submit,
        text: params.text,
      });
      if (!result.success) return this.failure(result.error ?? 'Fill failed');

      return this.success(
        `Filled ${params.ref} with "${params.text}"${params.submit ? ' and pressed Enter' : ''}.`,
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  press = async (params: BrowserPressArgs, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.press({
        key: params.key,
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success) return this.failure(result.error ?? 'Key press failed');
      return this.success(`Pressed ${params.key}.`);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  scroll = async (params: BrowserScrollArgs, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.scroll({
        dx: params.dx,
        dy: params.dy,
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success) return this.failure(result.error ?? 'Scroll failed');
      return this.success(`Scrolled by ${params.dy}px.`);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  screenshot = async (_params: object, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      await this.revealBrowserTab(ctx);
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.screenshot({
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success || !result.dataUrl)
        return this.failure(result.error ?? 'Screenshot failed');

      return this.success(
        `Screenshot captured (${result.width}×${result.height}) and shown to the user.`,
        { dataUrl: result.dataUrl, height: result.height, width: result.width },
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readPage = async (_params: object, ctx?: BuiltinToolContext) => {
    try {
      const disabled = await this.labDisabledFailure();
      if (disabled) return disabled;
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.readPage({
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success) return this.failure(result.error ?? 'Read page failed');

      return this.success(
        `Page: ${result.title ?? ''} (${result.url ?? ''})\n${result.content ?? ''}`,
        { content: result.content ?? '', title: result.title, url: result.url },
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Helpers ====================

  private sessionIdOf(ctx?: BuiltinToolContext): string {
    if (!ctx?.agentId) throw new Error('Browser tool requires an agent context');
    return `agent:${ctx.agentId}`;
  }

  /**
   * Keep the user in the loop — but only for the agent they are actually looking
   * at. Revealing the panel for a background agent would yank the user's view to
   * a run they didn't ask about, and (before pages were main-process owned) it
   * was how a background agent ended up driving the foreground agent's page.
   */
  private async revealBrowserTab(ctx?: BuiltinToolContext) {
    const [{ useAgentStore }, { useGlobalStore }] = await Promise.all([
      import('@/store/agent'),
      import('@/store/global'),
    ]);
    if (!ctx?.agentId || useAgentStore.getState().activeAgentId !== ctx.agentId) return;

    const store = useGlobalStore.getState();
    store.toggleRightPanel(true);
    store.setWorkingSidebarTab('browser');
  }

  private async waitForLoad(sessionId: string, timeoutMs = 8000): Promise<void> {
    const { electronBrowserSidebarService } = await import('@/services/electron/browserSidebar');
    const deadline = Date.now() + timeoutMs;
    // Give the navigation a beat to start before sampling isLoading.
    await sleep(500);
    while (Date.now() < deadline) {
      const state = await electronBrowserSidebarService.getState({ sessionId });
      if (!state.isLoading) return;
      await sleep(300);
    }
  }

  private success(content: string, state?: unknown): BuiltinToolResult {
    return { content, state, success: true };
  }

  private failure(message: string): BuiltinToolResult {
    return {
      content: message,
      error: { message, type: 'PluginServerError' },
      success: false,
    };
  }

  private errorResult(error: unknown): BuiltinToolResult {
    const message = (error as Error).message;
    return {
      content: message,
      error: { body: error, message, type: 'PluginServerError' },
      success: false,
    };
  }
}

// Export the executor instance for registration
export const browserExecutor = new BrowserExecutor();
