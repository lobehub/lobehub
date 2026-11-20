import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type {
  BrowserClickArgs,
  BrowserFillArgs,
  BrowserNavigateArgs,
  BrowserPressArgs,
  BrowserScrollArgs,
  BrowserSetViewportArgs,
  BrowserUploadedFile,
  BrowserUploadFileArgs,
  BrowserUploadFileState,
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
  setViewport: 'setViewport' as const,
  snapshot: 'snapshot' as const,
  uploadFile: 'uploadFile' as const,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const describeFiles = (files: BrowserUploadedFile[]) =>
  files.map((file) => `${file.name} (${formatSize(file.size)})`).join(', ');

/**
 * Browser Tool Executor (client / desktop only)
 *
 * Drives the in-app browser through the Electron IPC control gateway. Pages are
 * owned by the main process and keyed by session (`topic:<topicId>`), so every
 * topic drives its own page whether or not the user is watching it — a run in a
 * background topic never touches the page in front of the user, and two topics
 * of the same agent no longer trample each other's page.
 */
class BrowserExecutor extends BaseExecutor<typeof BrowserApiEnum> {
  readonly identifier = BrowserIdentifier;
  protected readonly apiEnum = BrowserApiEnum;

  navigate = async (params: BrowserNavigateArgs, ctx?: BuiltinToolContext) => {
    try {
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
      const loading = next.isLoading
        ? ' The page is still loading (some requests have not finished); its content may be incomplete, but snapshot/readPage work now.'
        : '';
      return this.success(
        `Opened ${next.url}${next.title ? ` — "${next.title}"` : ''}.${loading}`,
        {
          title: next.title,
          url: next.url,
        },
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  snapshot = async (_params: object, ctx?: BuiltinToolContext) => {
    try {
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.snapshot({
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success) return this.failure(result.error ?? 'Snapshot failed');

      const header = `Page: ${result.title ?? ''} (${result.url ?? ''})`;
      // A page with nothing interactive in view (an image, a JSON response, a
      // plain-text document) yields an empty snapshot. That is an answer, not a
      // failure — reporting it as one sent agents into retry loops.
      if (!result.snapshot) {
        return this.success(
          `${header}\nNo interactive elements (links, buttons, form fields, headings) are visible on this page. Use readPage to read its text, or screenshot to see it.`,
          { snapshot: '', title: result.title, url: result.url },
        );
      }

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

  setViewport = async (params: BrowserSetViewportArgs, ctx?: BuiltinToolContext) => {
    try {
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.setViewport({
        height: params.height,
        sessionId: this.sessionIdOf(ctx),
        width: params.width,
      });
      if (!result.success) return this.failure(result.error ?? 'Setting the viewport failed');

      if (params.width === undefined && params.height === undefined) {
        return this.success('Viewport reset to the browser panel size.');
      }
      const scale = result.scale ?? 1;
      const fitted =
        scale < 1
          ? ` The panel shows it at ${Math.round(scale * 100)}%, so screenshots come out at that scale.`
          : '';
      return this.success(`Viewport set to ${params.width}×${params.height}.${fitted}`);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  scroll = async (params: BrowserScrollArgs, ctx?: BuiltinToolContext) => {
    try {
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

  uploadFile = async (params: BrowserUploadFileArgs, ctx?: BuiltinToolContext) => {
    try {
      await this.revealBrowserTab(ctx);
      const { electronBrowserControlService } = await import('@/services/electron/browserControl');
      const result = await electronBrowserControlService.uploadFile({
        paths: params.paths,
        ref: params.ref,
        selector: params.selector,
        sessionId: this.sessionIdOf(ctx),
      });
      if (!result.success) {
        const reason = result.error ?? 'The file could not be attached';
        return result.manualSelectionRequired
          ? this.manualSelectionRequired(reason, params.paths)
          : this.failure(reason);
      }

      const files = result.files ?? [];
      const state: BrowserUploadFileState = {
        accept: result.accept,
        files,
        paths: params.paths,
        title: result.title,
        url: result.url,
        via: result.via,
      };
      // Reading the input back is the receipt: an empty list means the page
      // replaced or cleared the input in its change handler.
      if (files.length === 0) {
        return this.success(
          "The files were handed to the page's file input, but it holds no file now: the page took them in its change handler or cleared the input. Take a new snapshot to see whether the page lists or uploads them.",
          state,
        );
      }
      return this.success(
        `Attached ${describeFiles(files)} to the page's file input${result.via === 'fileChooser' ? ' through the file chooser its upload button opened' : ''}. The page handles them from here: take a new snapshot to see whether it uploaded them or still needs a confirm/submit click.`,
        state,
      );
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readPage = async (_params: object, ctx?: BuiltinToolContext) => {
    try {
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

  /**
   * The single place a browser session key is minted, for all three execution
   * paths (local runtime, cloud gateway, CC MCP). Keyed by topic, not agent: a
   * topic is what the user sees as "this conversation", so its page is the one
   * they expect the agent to be driving.
   *
   * A tool call always runs inside a persisted topic (the topic is created
   * before the first tool ever executes), so a missing topicId means a caller
   * dropped it in transit — fail loudly rather than silently sharing one page.
   */
  private sessionIdOf(ctx?: BuiltinToolContext): string {
    if (!ctx?.topicId) throw new Error('Browser tool requires a topic context');
    return `topic:${ctx.topicId}`;
  }

  /**
   * Keep the user in the loop — but only for the run they are actually looking
   * at. Revealing the panel for a background run would yank the user's view to
   * something they didn't ask about, and (before pages were main-process owned)
   * it was how a background agent ended up driving the foreground page.
   *
   * The topic must match too, not just the agent: the panel shows the *active*
   * topic's page, so revealing it for a sibling topic of the same agent would
   * present a blank page while the real action happens out of sight.
   */
  private async revealBrowserTab(ctx?: BuiltinToolContext) {
    const [{ useAgentStore }, { useChatStore }, { useGlobalStore }] = await Promise.all([
      import('@/store/agent'),
      import('@/store/chat'),
      import('@/store/global'),
    ]);
    if (!ctx?.agentId || useAgentStore.getState().activeAgentId !== ctx.agentId) return;
    if (!ctx.topicId || useChatStore.getState().activeTopicId !== ctx.topicId) return;

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

  /**
   * The structured "a person has to pick the file" answer. Without it an agent
   * kept trying other ways into the native file dialog (clicks, keys, desktop
   * screenshots) and used up its attempts.
   */
  private manualSelectionRequired(reason: string, paths: string[]): BuiltinToolResult {
    const state: BrowserUploadFileState = { manualSelectionRequired: true, paths, reason };
    const content = `${reason}\nThe file cannot be attached automatically on this page; the user has to choose it. Ask the user to select ${paths.join(', ')} in the browser panel themselves and tell you when it is done. Do not retry uploadFile or try to open the file dialog on this page.`;
    return {
      content,
      error: { body: state, message: reason, type: 'ManualFileSelectionRequired' },
      state,
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
