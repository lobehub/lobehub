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

const ATTACH_TIMEOUT_MS = 12_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Browser Tool Executor (client / desktop only)
 *
 * Drives the WorkingSidebar in-app browser through the Electron IPC control
 * gateway. The browser session is shared with the UI (`agent:<agentId>`), so
 * the user watches every action live in the sidebar.
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

      const state = await electronBrowserSidebarService.getState({ sessionId });

      if (state.attached) {
        await this.revealBrowserTab();
        const result = await electronBrowserSidebarService.navigate({
          sessionId,
          url: params.url,
        });
        if (!result.success) return this.failure(result.error ?? 'Navigation failed');
      } else {
        // No webview yet — mount it through the store request, which also opens
        // the right panel and switches to the browser tab.
        const { useGlobalStore } = await import('@/store/global');
        useGlobalStore.getState().openInBrowserTab(params.url);

        const attached = await this.waitForAttach(sessionId);
        if (!attached)
          return this.failure(
            'The in-app browser did not open. Make sure the conversation is visible in the desktop app.',
          );
      }

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
      await this.revealBrowserTab();
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
      await this.revealBrowserTab();
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
      await this.revealBrowserTab();
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

  /** Keep the user in the loop: surface the browser tab whenever the agent acts. */
  private async revealBrowserTab() {
    const { useGlobalStore } = await import('@/store/global');
    const store = useGlobalStore.getState();
    store.toggleRightPanel(true);
    store.setWorkingSidebarTab('browser');
  }

  private async waitForAttach(sessionId: string): Promise<boolean> {
    const { electronBrowserSidebarService } = await import('@/services/electron/browserSidebar');
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await electronBrowserSidebarService.getState({ sessionId });
      if (state.attached) return true;
      await sleep(300);
    }
    return false;
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
