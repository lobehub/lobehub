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
   * Post a user message into the conversation; resolves `false` when the host
   * declined it. `signal` aborts when the view stops waiting for the answer.
   */
  sendMessage: (text: string, signal: AbortSignal) => Promise<boolean | void> | boolean | void;
  toolInput: () => Record<string, unknown>;
  toolResult: () => CallToolResult;
}

/**
 * Connect LobeHub to an MCP Apps view living in `target` (the sandboxed
 * iframe's window). Returns a disposer that closes the session.
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

  bridge.onopenlink = async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { isError: true };

    window.open(url, '_blank', 'noopener,noreferrer');
    return {};
  };

  const handleSizeChange = ({ height }: McpUiSizeChangedNotification['params']) => {
    if (typeof height === 'number' && height > 0) host.onSizeChange(Math.ceil(height));
  };

  const handleInitialized = () => {
    void bridge.sendToolInput({ arguments: host.toolInput() });
    void bridge.sendToolResult(host.toolResult());
  };

  bridge.addEventListener('sizechange', handleSizeChange);
  bridge.addEventListener('initialized', handleInitialized);
  void bridge.connect(new PostMessageTransport(target, target));

  return {
    bridge,
    dispose: () => {
      bridge.removeEventListener('sizechange', handleSizeChange);
      bridge.removeEventListener('initialized', handleInitialized);
      void bridge.close();
    },
  };
};
