/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_APP_VIEW_HEIGHT } from './appHost';
import {
  connectMcpUiView,
  formatMcpUiIntent,
  MCP_UI_NOTIFY_MAX_LENGTH,
  parseMcpUiMessage,
} from './mcpUiHost';

const {
  confirmAppMessage,
  confirmAppOpenLink,
  confirmAppToolCall,
  getAppToolCallPolicy,
  invokeMcpToolCall,
  sendMessage,
} = vi.hoisted(() => ({
  confirmAppMessage: vi.fn(),
  confirmAppOpenLink: vi.fn(),
  confirmAppToolCall: vi.fn(),
  getAppToolCallPolicy: vi.fn(),
  invokeMcpToolCall: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/services/mcp', () => ({ mcpService: { invokeMcpToolCall } }));
vi.mock('@/store/tool', () => ({ getToolStoreState: () => ({}) }));
vi.mock('@/store/tool/slices/connector/selectors', () => ({
  connectorSelectors: { connectorByIdentifierForAgent: () => () => undefined },
}));
vi.mock('./appName', () => ({ mcpAppNameSelector: () => () => 'Card Demo' }));
vi.mock('./confirm', () => ({ confirmAppMessage, confirmAppOpenLink, confirmAppToolCall }));
vi.mock('./toolCallPolicy', () => ({ getAppToolCallPolicy }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const disposers: (() => void)[] = [];

const setup = ({ canSendMessage = true, isDark = false } = {}) => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const target = iframe.contentWindow!;
  const posted = vi.spyOn(target, 'postMessage');
  const onHeight = vi.fn();
  const notify = vi.fn();
  const context = {
    agentId: 'agt_1',
    args: '{"city":"Paris"}',
    canSendMessage,
    identifier: 'card-demo',
    isDark,
    onThisDevice: false,
    result: { content: 'ok', state: { content: [], structuredContent: { temp: 21 } } },
    sendMessage,
    server: 'card-server',
    t: (key: string) => key,
  };
  const session = connectMcpUiView({
    getContext: () => context,
    notify,
    onHeight,
    onWaitingApprovalsChange: vi.fn(),
    target,
    toolCallId: 'call_1',
  });
  disposers.push(session.dispose);

  const fromView = async (data: unknown, source: unknown = target) => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
    await flush();
    await flush();
  };
  const sent = () => posted.mock.calls.map(([message]) => message as any);
  const response = (messageId: string) =>
    sent().find((m) => m.type === 'ui-message-response' && m.payload.messageId === messageId);

  return { context, fromView, notify, onHeight, posted, response, sent, session, target };
};

beforeEach(() => {
  vi.clearAllMocks();
  getAppToolCallPolicy.mockResolvedValue('allow');
});

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.innerHTML = '';
});

describe('parseMcpUiMessage', () => {
  it('keeps the supported MCP-UI messages', () => {
    expect(
      parseMcpUiMessage({
        messageId: 'm1',
        payload: { params: { q: 1 }, toolName: 'refresh' },
        type: 'tool',
      }),
    ).toEqual({
      messageId: 'm1',
      payload: { params: { q: 1 }, toolName: 'refresh' },
      type: 'tool',
    });
    expect(parseMcpUiMessage({ payload: { height: 480 }, type: 'ui-size-change' })).toEqual({
      height: 480,
      type: 'ui-size-change',
    });
    expect(parseMcpUiMessage({ type: 'ui-lifecycle-iframe-ready' })).toEqual({
      type: 'ui-lifecycle-iframe-ready',
    });
  });

  it('drops malformed or foreign messages', () => {
    expect(parseMcpUiMessage({ jsonrpc: '2.0', method: 'ui/initialize' })).toBeUndefined();
    expect(parseMcpUiMessage({ payload: {}, type: 'tool' })).toBeUndefined();
    expect(parseMcpUiMessage({ payload: { height: -1 }, type: 'ui-size-change' })).toBeUndefined();
    expect(parseMcpUiMessage({ payload: { prompt: '   ' }, type: 'prompt' })).toBeUndefined();
    expect(parseMcpUiMessage('tool')).toBeUndefined();
  });

  it('defaults missing tool params to an empty object', () => {
    expect(parseMcpUiMessage({ payload: { toolName: 'x' }, type: 'tool' })).toMatchObject({
      payload: { params: {} },
    });
  });
});

describe('connectMcpUiView', () => {
  it('answers ready with render data built from the tool call', async () => {
    const view = setup({ isDark: true });
    await view.fromView({ type: 'ui-lifecycle-iframe-ready' });

    expect(view.sent()).toContainEqual({
      payload: {
        renderData: {
          locale: navigator.language,
          theme: 'dark',
          toolInput: { city: 'Paris' },
          toolOutput: { temp: 21 },
        },
      },
      type: 'ui-lifecycle-iframe-render-data',
    });
    // Opaque-origin frames are reached only through their own window
    expect(view.posted).toHaveBeenCalledWith(expect.anything(), '*');
  });

  it('ignores messages from any window but the view frame', async () => {
    const view = setup();
    await view.fromView({ payload: { height: 500 }, type: 'ui-size-change' }, window);
    await view.fromView({ messageId: 'm1', payload: { toolName: 'x' }, type: 'tool' }, null);

    expect(view.onHeight).not.toHaveBeenCalled();
    expect(invokeMcpToolCall).not.toHaveBeenCalled();
    expect(view.sent()).toEqual([]);
  });

  it('resizes the frame, within the host maximum', async () => {
    const view = setup();
    await view.fromView({ payload: { height: 412.4 }, type: 'ui-size-change' });
    await view.fromView({ payload: { height: 99_999 }, type: 'ui-size-change' });

    expect(view.onHeight).toHaveBeenNthCalledWith(1, 413);
    expect(view.onHeight).toHaveBeenNthCalledWith(2, MAX_APP_VIEW_HEIGHT);
  });

  it('runs a tool call on the view server and returns its result', async () => {
    invokeMcpToolCall.mockResolvedValue({
      content: 'refreshed',
      state: { content: [{ text: 'refreshed', type: 'text' }], mcpUi: { server: 'card-server' } },
      success: true,
    });
    const view = setup();
    await view.fromView({
      messageId: 'm1',
      payload: { params: { city: 'Rome' }, toolName: 'refresh' },
      type: 'tool',
    });

    expect(invokeMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'refresh',
        arguments: '{"city":"Rome"}',
        identifier: 'card-demo',
      }),
      expect.objectContaining({ fromMcpApp: true, server: 'card-server' }),
    );
    expect(view.sent()[0]).toEqual({ payload: { messageId: 'm1' }, type: 'ui-message-received' });
    // The marker stays the host's: the view gets the MCP result only
    expect(view.response('m1')).toEqual({
      payload: { messageId: 'm1', response: { content: [{ text: 'refreshed', type: 'text' }] } },
      type: 'ui-message-response',
    });
  });

  it('asks before a tool call the conversation would ask for, and reports a refusal', async () => {
    getAppToolCallPolicy.mockResolvedValue('confirm');
    confirmAppToolCall.mockResolvedValue(false);
    const view = setup();
    await view.fromView({ messageId: 'm2', payload: { toolName: 'delete' }, type: 'tool' });

    expect(confirmAppToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'delete' }));
    expect(invokeMcpToolCall).not.toHaveBeenCalled();
    expect(view.response('m2').payload.response).toMatchObject({ isError: true });
  });

  it('posts a prompt or an intent as a message only after the user agrees', async () => {
    confirmAppMessage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    sendMessage.mockImplementation(async ({ onMessageAccepted }) => onMessageAccepted());
    const view = setup();
    await view.fromView({ messageId: 'p1', payload: { prompt: 'Plan a trip' }, type: 'prompt' });
    await view.fromView({
      messageId: 'i1',
      payload: { intent: 'book', params: { id: 7 } },
      type: 'intent',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'Plan a trip' }));
    expect(confirmAppMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: formatMcpUiIntent('book', { id: 7 }) }),
    );
    expect(view.response('p1').payload.response).toEqual({ sent: true });
    expect(view.response('i1').payload.response).toEqual({ sent: false });
  });

  it('refuses messages on a read-only conversation without asking', async () => {
    const view = setup({ canSendMessage: false });
    await view.fromView({ messageId: 'p1', payload: { prompt: 'hi' }, type: 'prompt' });

    expect(confirmAppMessage).not.toHaveBeenCalled();
    expect(view.response('p1').payload.response).toEqual({ sent: false });
  });

  it('opens http(s) links after confirmation and refuses other schemes', async () => {
    confirmAppOpenLink.mockResolvedValue(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = setup();
    await view.fromView({ messageId: 'l1', payload: { url: 'https://example.com' }, type: 'link' });
    await view.fromView({ messageId: 'l2', payload: { url: 'javascript:alert(1)' }, type: 'link' });

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(view.response('l1').payload.response).toEqual({ opened: true });
    expect(view.response('l2').payload.response).toEqual({ opened: false });
    expect(confirmAppOpenLink).toHaveBeenCalledTimes(1);
  });

  it('shows a notice, cut to length and at most one per interval', async () => {
    const view = setup();
    await view.fromView({
      messageId: 'n1',
      payload: { message: 'x'.repeat(MCP_UI_NOTIFY_MAX_LENGTH + 10) },
      type: 'notify',
    });
    await view.fromView({ messageId: 'n2', payload: { message: 'again' }, type: 'notify' });

    expect(view.notify).toHaveBeenCalledTimes(1);
    expect(view.notify.mock.calls[0][0]).toHaveLength(MCP_UI_NOTIFY_MAX_LENGTH + 1);
    expect(view.response('n1').payload.response).toEqual({ shown: true });
    expect(view.response('n2').payload.response).toEqual({ shown: false });
  });

  it('reports a failed request as an error response', async () => {
    invokeMcpToolCall.mockRejectedValue(new Error('server moved'));
    const view = setup();
    await view.fromView({ messageId: 'm3', payload: { toolName: 'refresh' }, type: 'tool' });

    expect(view.response('m3').payload).toEqual({ error: 'server moved', messageId: 'm3' });
  });

  it('stops listening and answering once disposed', async () => {
    const view = setup();
    view.session.dispose();
    await view.fromView({ payload: { height: 300 }, type: 'ui-size-change' });
    await view.fromView({ type: 'ui-lifecycle-iframe-ready' });

    expect(view.onHeight).not.toHaveBeenCalled();
    expect(view.sent()).toEqual([]);
  });
});
