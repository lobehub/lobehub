import { MCP_APP_CONTEXT_MAX_LENGTH } from '@lobechat/const/mcpApp';
import { safeParseJSON } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';

import { MAX_APP_VIEW_HEIGHT } from './appHost';
import { type AppViewContext, createAppViewActions } from './viewActions';

/**
 * The MCP-UI postMessage protocol (https://mcpui.dev), spoken by views a tool
 * result embeds as `ui://` resources. Messages are plain objects, not JSON-RPC:
 *
 * View → host
 * - `{ type: 'tool', payload: { toolName, params }, messageId? }` call a tool on the view's server
 * - `{ type: 'prompt', payload: { prompt }, messageId? }` post a message to the conversation
 * - `{ type: 'intent', payload: { intent, params? }, messageId? }` post the intent as a message
 * - `{ type: 'notify', payload: { message }, messageId? }` show a notice
 * - `{ type: 'link', payload: { url }, messageId? }` open a link
 * - `{ type: 'ui-size-change', payload: { height } }` resize the frame
 * - `{ type: 'ui-lifecycle-iframe-ready' }` / `{ type: 'ui-request-render-data', messageId? }`
 *
 * Host → view
 * - `{ type: 'ui-message-received', payload: { messageId } }` the request arrived
 * - `{ type: 'ui-message-response', payload: { messageId, response } | { messageId, error } }`
 * - `{ type: 'ui-lifecycle-iframe-render-data', payload: { renderData }, messageId? }`
 *
 * Everything the view asks for goes through the same approval rules as an MCP
 * Apps view (`createAppViewActions`).
 */

export type McpUiActionType = 'intent' | 'link' | 'notify' | 'prompt' | 'tool';

export type McpUiViewMessage =
  | {
      messageId?: string;
      payload: { params: Record<string, unknown>; toolName: string };
      type: 'tool';
    }
  | {
      messageId?: string;
      payload: { intent: string; params?: Record<string, unknown> };
      type: 'intent';
    }
  | { messageId?: string; payload: { prompt: string }; type: 'prompt' }
  | { messageId?: string; payload: { message: string }; type: 'notify' }
  | { messageId?: string; payload: { url: string }; type: 'link' }
  | { height: number; type: 'ui-size-change' }
  | { messageId?: string; type: 'ui-lifecycle-iframe-ready' | 'ui-request-render-data' };

export interface McpUiRenderData {
  locale: string;
  theme: 'dark' | 'light';
  /** The arguments of the tool call whose result carries the view. */
  toolInput: Record<string, unknown>;
  /** That result's `structuredContent`, when it has one. */
  toolOutput?: unknown;
}

/** Longest notice a view may show; longer ones are cut. */
export const MCP_UI_NOTIFY_MAX_LENGTH = 300;
/** A view shows at most one notice per interval; the rest are dropped. */
export const MCP_UI_NOTIFY_INTERVAL_MS = 2000;

const text = (value: unknown, max = MCP_APP_CONTEXT_MAX_LENGTH) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;

/** Validate one message a view posted; anything else is not ours and is ignored. */
export const parseMcpUiMessage = (data: unknown): McpUiViewMessage | undefined => {
  if (!isRecord(data) || typeof data.type !== 'string') return;
  const messageId =
    typeof data.messageId === 'string' && data.messageId.length <= 256 ? data.messageId : undefined;
  const id = messageId === undefined ? {} : { messageId };
  const payload = isRecord(data.payload) ? data.payload : {};

  switch (data.type) {
    case 'tool': {
      const toolName = text(payload.toolName, 256);
      if (!toolName) return;
      const params = isRecord(payload.params) ? payload.params : {};
      return { ...id, payload: { params, toolName }, type: 'tool' };
    }
    case 'intent': {
      const intent = text(payload.intent, 256);
      if (!intent) return;
      return {
        ...id,
        payload: { intent, ...(isRecord(payload.params) && { params: payload.params }) },
        type: 'intent',
      };
    }
    case 'prompt': {
      const prompt = text(payload.prompt);
      return prompt ? { ...id, payload: { prompt }, type: 'prompt' } : undefined;
    }
    case 'notify': {
      const message = text(payload.message);
      return message ? { ...id, payload: { message }, type: 'notify' } : undefined;
    }
    case 'link': {
      const url = text(payload.url, 4096);
      return url ? { ...id, payload: { url }, type: 'link' } : undefined;
    }
    case 'ui-size-change': {
      const height = payload.height;
      return typeof height === 'number' && Number.isFinite(height) && height > 0
        ? { height, type: 'ui-size-change' }
        : undefined;
    }
    case 'ui-lifecycle-iframe-ready':
    case 'ui-request-render-data': {
      return { ...id, type: data.type };
    }
    default: {
      return undefined;
    }
  }
};

const isHttpUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/** The message an intent posts: its name, then its parameters as JSON. */
export const formatMcpUiIntent = (intent: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length > 0
    ? `${intent}\n\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\``
    : intent;

export interface ConnectMcpUiViewOptions {
  getContext: () => AppViewContext;
  /** Show a view's notice to the user. */
  notify: (message: string) => void;
  onHeight: (height: number) => void;
  /** As `connectAppView`: `+1` when a request starts waiting for the user, `-1` when it stops. */
  onWaitingApprovalsChange: (delta: 1 | -1) => void;
  /**
   * The frame's window. Its document runs on an opaque origin, which no
   * `targetOrigin` but `'*'` reaches: messages are taken only from, and sent
   * only to, this window.
   */
  target: Window;
  toolCallId: string;
}

export interface McpUiViewSession {
  dispose: () => void;
  /** Send the view its render data again (the theme changed). */
  sendRenderData: () => void;
}

/** Connect LobeHub to one MCP-UI view in `target`. Call `dispose` once the view goes away. */
export const connectMcpUiView = ({
  getContext,
  notify,
  onHeight,
  onWaitingApprovalsChange,
  target,
  toolCallId,
}: ConnectMcpUiViewOptions): McpUiViewSession => {
  const actions = createAppViewActions({ getContext, onWaitingApprovalsChange, toolCallId });
  // Every request the view made ends with it
  const session = new AbortController();
  let lastNotice = Number.NEGATIVE_INFINITY;

  const post = (message: Record<string, unknown>) => {
    if (!session.signal.aborted) target.postMessage(message, '*');
  };

  const renderData = (): McpUiRenderData => {
    const { args, isDark, result } = getContext();
    const toolInput = safeParseJSON(args || '{}');
    const structured = (result.state as { structuredContent?: unknown } | undefined)
      ?.structuredContent;
    return {
      locale: navigator.language,
      theme: isDark ? 'dark' : 'light',
      toolInput: isRecord(toolInput) ? toolInput : {},
      ...(structured !== undefined && { toolOutput: structured }),
    };
  };

  const sendRenderData = (messageId?: string) =>
    post({
      ...(messageId && { messageId }),
      payload: { renderData: renderData() },
      type: 'ui-lifecycle-iframe-render-data',
    });

  const run = (
    message: Extract<McpUiViewMessage, { type: McpUiActionType }>,
  ): Promise<unknown> | unknown => {
    const { signal } = session;
    switch (message.type) {
      case 'tool': {
        return actions.callTool(message.payload.toolName, message.payload.params, signal);
      }
      case 'prompt': {
        return actions.sendMessage(message.payload.prompt, signal).then((sent) => ({ sent }));
      }
      case 'intent': {
        const { intent, params } = message.payload;
        return actions.sendMessage(formatMcpUiIntent(intent, params), signal).then((sent) => ({
          sent,
        }));
      }
      case 'link': {
        if (!isHttpUrl(message.payload.url)) return { opened: false };
        return actions.openLink(message.payload.url, signal).then((opened) => ({ opened }));
      }
      case 'notify': {
        const now = Date.now();
        if (now - lastNotice < MCP_UI_NOTIFY_INTERVAL_MS) return { shown: false };
        lastNotice = now;
        const { message: notice } = message.payload;
        notify(
          notice.length > MCP_UI_NOTIFY_MAX_LENGTH
            ? `${notice.slice(0, MCP_UI_NOTIFY_MAX_LENGTH)}…`
            : notice,
        );
        return { shown: true };
      }
    }
  };

  const handleMessage = (event: MessageEvent) => {
    // Views run sandboxed without allow-same-origin, so their origin is always "null"
    if (event.source !== target || event.origin !== 'null') return;
    const message = parseMcpUiMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case 'ui-size-change': {
        onHeight(Math.min(Math.ceil(message.height), MAX_APP_VIEW_HEIGHT));
        return;
      }
      case 'ui-lifecycle-iframe-ready':
      case 'ui-request-render-data': {
        sendRenderData(message.messageId);
        return;
      }
    }

    const { messageId } = message;
    if (messageId) post({ payload: { messageId }, type: 'ui-message-received' });
    Promise.resolve()
      .then(() => run(message))
      .then(
        (response) => {
          if (messageId) post({ payload: { messageId, response }, type: 'ui-message-response' });
        },
        (error: unknown) => {
          if (!messageId) return;
          const reason = error instanceof Error ? error.message : String(error);
          post({ payload: { error: reason, messageId }, type: 'ui-message-response' });
        },
      );
  };

  window.addEventListener('message', handleMessage);

  return {
    dispose: () => {
      window.removeEventListener('message', handleMessage);
      session.abort();
      actions.end();
    },
    sendRenderData: () => sendRenderData(),
  };
};
