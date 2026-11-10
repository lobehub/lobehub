import { CURRENT_VERSION } from '@lobechat/const';
import type { CallToolResult } from '@modelcontextprotocol/client';
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiSizeChangedNotification,
  PostMessageTransport,
} from '@modelcontextprotocol/ext-apps/app-bridge';

export const buildHostContext = (isDark: boolean): McpUiHostContext => ({
  availableDisplayModes: ['inline'],
  displayMode: 'inline',
  locale: navigator.language,
  platform: 'web',
  theme: isDark ? 'dark' : 'light',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

export interface McpAppBridgeHost {
  /**
   * Call a tool on the server that rendered the view. `signal` aborts when the
   * view stops waiting for the answer (it timed out or cancelled the request).
   */
  callTool: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<CallToolResult>;
  hostContext: McpUiHostContext;
  onSizeChange: (height: number) => void;
  /**
   * Open an http(s) link the view asked for; resolves `false` when the host
   * declined it. `signal` aborts when the view stops waiting for the answer.
   */
  openLink: (url: string, signal: AbortSignal) => Promise<boolean>;
  /**
   * Post a user message into the conversation; resolves `false` when the host
   * declined it. `signal` aborts when the view stops waiting for the answer.
   */
  sendMessage: (text: string, signal: AbortSignal) => Promise<boolean | void> | boolean | void;
  toolInput: () => Record<string, unknown>;
  /** The result the view renders; may resolve later (stored media is read back first). */
  toolResult: () => CallToolResult | Promise<CallToolResult>;
}

/**
 * Connect LobeHub to an MCP Apps view living in `target` (the sandboxed
 * iframe's window). `dispose` closes the session at once; `teardown` first
 * lets the view finish, as MCP Apps asks before a view is removed.
 */
export const connectMcpAppBridge = (target: Window, host: McpAppBridgeHost) => {
  const bridge = new AppBridge(
    null,
    { name: 'LobeHub', version: CURRENT_VERSION },
    { message: { text: {} }, openLinks: {}, serverTools: {} },
    { hostContext: host.hostContext },
  );

  bridge.oncalltool = ({ arguments: args, name }, { mcpReq }) =>
    host.callTool(name, args ?? {}, mcpReq.signal);

  bridge.onmessage = async ({ content }, { mcpReq }) => {
    const text = content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim();
    if (!text) return { isError: true };

    const sent = await host.sendMessage(text, mcpReq.signal);
    return sent === false ? { isError: true } : {};
  };

  bridge.onopenlink = async ({ url }, { mcpReq }) => {
    if (!/^https?:\/\//i.test(url)) return { isError: true };

    return (await host.openLink(url, mcpReq.signal)) ? {} : { isError: true };
  };

  const handleSizeChange = ({ height }: McpUiSizeChangedNotification['params']) => {
    if (typeof height === 'number' && height > 0) host.onSizeChange(Math.ceil(height));
  };

  let initialized = false;
  const handleInitialized = () => {
    initialized = true;
    void bridge.sendToolInput({ arguments: host.toolInput() });
    void Promise.resolve(host.toolResult()).then((result) => bridge.sendToolResult(result));
  };

  bridge.addEventListener('sizechange', handleSizeChange);
  bridge.addEventListener('initialized', handleInitialized);
  void bridge.connect(new PostMessageTransport(target, target));

  const dispose = () => {
    bridge.removeEventListener('sizechange', handleSizeChange);
    bridge.removeEventListener('initialized', handleInitialized);
    void bridge.close();
  };

  return {
    bridge,
    dispose,
    /**
     * Tell the view it is going away (`ui/resource-teardown`) and give it up to
     * `timeoutMs` to finish (save pending edits) before the session closes. A
     * view that never initialized has nothing to finish.
     */
    teardown: async (timeoutMs: number) => {
      if (initialized) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          bridge.teardownResource({}).catch(() => {}),
          new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs))),
        ]);
        clearTimeout(timer);
      }
      dispose();
    },
  };
};
