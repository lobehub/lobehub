/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectAppView, getAppViewPhase, MAX_APP_VIEW_HEIGHT } from './appHost';
import { buildAppFrameDocument, VIEW_FRAME_SANDBOX } from './frameDocument';
import { APP_IFRAME_ALLOW, buildAppCsp } from './utils';

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

vi.mock('./appName', () => ({ mcpAppNameSelector: () => () => 'Weather Demo' }));

vi.mock('./confirm', () => ({ confirmAppMessage, confirmAppOpenLink, confirmAppToolCall }));

vi.mock('./toolCallPolicy', () => ({ getAppToolCallPolicy }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const disposers: (() => void)[] = [];

/** Connect a view in a fresh frame, as McpAppView does once the frame has loaded. */
const setup = ({ canSendMessage = true }: { canSendMessage?: boolean } = {}) => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const target = iframe.contentWindow!;
  const posted = vi.spyOn(target, 'postMessage');
  const onHeight = vi.fn();
  const onNavigated = vi.fn();
  let waiting = 0;
  const onWaitingApprovalsChange = vi.fn((delta: 1 | -1) => (waiting += delta));

  const { dispose, teardown } = connectAppView({
    getContext: () => ({
      agentId: 'agt_1',
      args: '{"city":"Paris"}',
      canSendMessage,
      identifier: 'weather-demo',
      isDark: false,
      onThisDevice: true,
      result: { content: 'sunny' },
      sendMessage,
      server: 'weather-server',
      t: (key: string) => key,
    }),
    onHeight,
    onNavigated,
    onWaitingApprovalsChange,
    resourceUri: 'ui://weather/view',
    target,
    toolCallId: 'call_1',
  });
  let disposed = false;
  const goAway = () => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
  disposers.push(goAway);

  /** Deliver a JSON-RPC message as if the view posted it. */
  const fromView = async (data: Record<string, unknown>) => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', ...data }, source: target }),
    );
    await flush();
  };
  const sent = () => posted.mock.calls.map(([message]) => message as any);
  const response = (id: number) => sent().find((message) => message.id === id);
  const message = (id: number, text: string) =>
    fromView({
      id,
      method: 'ui/message',
      params: { content: [{ text, type: 'text' }], role: 'user' },
    });
  const call = (id: number, city: string) =>
    fromView({ id, method: 'tools/call', params: { arguments: { city }, name: 'get_forecast' } });

  return {
    call,
    dispose: goAway,
    fromView,
    iframe,
    message,
    onHeight,
    onNavigated,
    onWaitingApprovalsChange,
    response,
    sent,
    target,
    teardown: () => {
      disposed = true;
      return teardown();
    },
    waiting: () => waiting,
  };
};

describe('the frame an MCP App view runs in', () => {
  it('keeps powerful features off whatever permissions the view declares', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'clipboard-write']) {
      expect(APP_IFRAME_ALLOW).toContain(`${feature} 'none'`);
    }
    expect(VIEW_FRAME_SANDBOX).toBe('allow-scripts allow-forms');
  });

  it('loads the view behind the wrapper that holds it to its declared frame domains', () => {
    const doc = buildAppFrameDocument('<p>weather</p>', buildAppCsp(undefined));

    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'));
    expect(doc).toContain(`frame-src 'none'`);
    expect(doc).toContain('frame.srcdoc = ');
    expect(doc).toContain('\\u003cp>weather\\u003c/p>');
  });
});

describe('getAppViewPhase', () => {
  it('shows the skeleton while the document loads', () => {
    expect(getAppViewPhase({ isLoading: true, navigated: false })).toBe('loading');
  });

  it('falls back without a document, or once the view left its document', () => {
    expect(getAppViewPhase({ isLoading: false, navigated: false })).toBe('fallback');
    expect(getAppViewPhase({ isLoading: false, navigated: true, srcDoc: '<p />' })).toBe(
      'fallback',
    );
  });

  it('keeps a loaded view when a revalidation of its HTML fails', () => {
    // A failed SWR revalidation keeps `data`: the document, not the error, decides
    expect(getAppViewPhase({ isLoading: false, navigated: false, srcDoc: '<p />' })).toBe('view');
  });
});

describe('connectAppView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppToolCallPolicy.mockResolvedValue('confirm');
    sendMessage.mockImplementation(async ({ onMessageAccepted }) => onMessageAccepted?.());
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('caps the height a view asks for', async () => {
    const { fromView, onHeight } = setup();

    await fromView({ method: 'ui/notifications/size-changed', params: { height: 99_999 } });

    expect(onHeight).toHaveBeenCalledWith(MAX_APP_VIEW_HEIGHT);
  });

  it('reports a view that left its document, only from its own frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onNavigated, target } = setup();
    const notice = { source: 'lobe-mcp-app-frame', type: 'navigated' };

    window.dispatchEvent(new MessageEvent('message', { data: notice, source: window }));
    await flush();
    expect(onNavigated).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', { data: notice, source: target }));
    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('left its document'));
  });

  it('drops the approvals of a view once it goes away, as after leaving its document', async () => {
    confirmAppToolCall.mockImplementation(() => new Promise(() => {}));
    const { call, dispose } = setup();

    await call(1, 'Rome');
    const { signal } = confirmAppToolCall.mock.calls[0][0] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    // McpAppView disposes the session when the wrapper reports the view left
    dispose();
    expect(signal.aborted).toBe(true);
  });

  it('requires consent for a message from any of several views, whichever has focus', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true },
    });
    confirmAppMessage.mockResolvedValue(false);
    const first = setup();
    const second = setup();
    clock.mockReturnValue(5000);
    first.iframe.focus();
    // Focus can be stolen by a view that did not receive the user's click.
    second.iframe.focus();

    await second.message(1, 'What should I wear?');

    expect(confirmAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'What should I wear?' }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(second.response(1)?.result).toEqual({ isError: true });
    Reflect.deleteProperty(navigator, 'userActivation');
  });

  it('asks before sending a message posted without a gesture, and drops it when declined', async () => {
    confirmAppMessage.mockResolvedValue(false);
    const { message, response } = setup();

    await message(1, 'Posted on load');

    expect(confirmAppMessage).toHaveBeenCalledWith({
      appName: 'Weather Demo',
      signal: expect.any(AbortSignal),
      text: 'Posted on load',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(response(1)?.result).toEqual({ isError: true });
  });

  it('refuses a message in a conversation that takes none, without asking', async () => {
    const { message, response } = setup({ canSendMessage: false });

    await message(1, 'Reply in this thread');

    expect(confirmAppMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(response(1)?.result).toEqual({ isError: true });
  });

  it('refuses a second message while one is still pending', async () => {
    let confirmMessage!: (allowed: boolean) => void;
    confirmAppMessage.mockReturnValue(new Promise((resolve) => (confirmMessage = resolve)));
    const { message, response } = setup();

    await message(1, 'first');
    await message(2, 'second');
    expect(response(2)?.result).toEqual({ isError: true });
    expect(confirmAppMessage).toHaveBeenCalledTimes(1);

    confirmMessage(true);
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(response(1)?.result).toEqual({});
  });

  it('shows the app by name and the arguments before a tool call that needs approval', async () => {
    confirmAppToolCall.mockResolvedValue(false);
    const { call, response } = setup();

    await call(1, 'Rome');

    expect(confirmAppToolCall).toHaveBeenCalledWith({
      appName: 'Weather Demo',
      args: { city: 'Rome' },
      signal: expect.any(AbortSignal),
      tool: 'get_forecast',
    });
    expect(invokeMcpToolCall).not.toHaveBeenCalled();
    expect(response(1)?.result.isError).toBe(true);
  });

  it('asks about parallel tool calls in turn instead of refusing the later ones', async () => {
    const answers: ((allowed: boolean) => void)[] = [];
    confirmAppToolCall.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    invokeMcpToolCall.mockResolvedValue({ content: 'rainy', success: true });
    const { call, response } = setup();

    await call(1, 'Rome');
    await call(2, 'Oslo');
    // Both wait for an answer; the confirm queue shows their modals one at a time
    expect(confirmAppToolCall).toHaveBeenCalledTimes(2);
    expect(response(2)).toBeUndefined();

    answers[0](true);
    answers[1](false);
    await flush();
    expect(invokeMcpToolCall).toHaveBeenCalledTimes(1);
    expect(response(1)?.result.isError).toBeFalsy();
    expect(response(2)?.result).toMatchObject({
      content: [{ text: 'mcpApp.toolCall.rejected' }],
      isError: true,
    });
  });

  it('refuses tool calls as busy, not denied, once too many wait for approval', async () => {
    const answers: ((allowed: boolean) => void)[] = [];
    confirmAppToolCall.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { call, response } = setup();

    for (const id of [1, 2, 3, 4]) await call(id, 'Rome');

    expect(confirmAppToolCall).toHaveBeenCalledTimes(3);
    expect(response(4)?.result).toMatchObject({
      content: [{ text: 'mcpApp.toolCall.busy' }],
      isError: true,
    });

    // Answering one frees a slot
    answers[0](false);
    await flush();
    await call(5, 'Rome');
    expect(confirmAppToolCall).toHaveBeenCalledTimes(4);
  });

  it('drops an approval once the view stops waiting for that request', async () => {
    // Like the real confirm: an aborted approval resolves `false`, whatever the user clicks later
    const settle = ({ signal }: { signal: AbortSignal }) =>
      new Promise<boolean>((resolve) =>
        signal.addEventListener('abort', () => resolve(false), { once: true }),
      );
    confirmAppToolCall.mockImplementation(settle);
    confirmAppMessage.mockImplementation(settle);
    const { call, fromView, message } = setup();
    const cancel = (requestId: number) =>
      fromView({ method: 'notifications/cancelled', params: { reason: 'timeout', requestId } });

    await call(1, 'Rome');
    await call(2, 'Oslo');
    await message(3, 'Posted on load');
    const [first, second] = confirmAppToolCall.mock.calls.map(
      ([options]) => (options as { signal: AbortSignal }).signal,
    );
    const { signal: messageSignal } = confirmAppMessage.mock.calls[0][0] as {
      signal: AbortSignal;
    };

    // The view timed out on its first call and on the message
    await cancel(1);
    await cancel(3);

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(messageSignal.aborted).toBe(true);
    expect(invokeMcpToolCall).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('asks for approval, and drops it on cancel, in browsers without AbortSignal.any', async () => {
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any is not a function');
    });
    confirmAppToolCall.mockReturnValue(new Promise(() => {}));
    const { call, fromView } = setup();

    await call(1, 'Rome');
    expect(confirmAppToolCall).toHaveBeenCalledTimes(1);
    const { signal } = confirmAppToolCall.mock.calls[0][0] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    await fromView({ method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(signal.aborted).toBe(true);
  });

  it('counts its requests waiting for an answer, for the status under the view', async () => {
    const answers: ((allowed: boolean) => void)[] = [];
    confirmAppToolCall.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { call, waiting } = setup();
    expect(waiting()).toBe(0);

    await call(1, 'Rome');
    await call(2, 'Oslo');
    expect(waiting()).toBe(2);

    // Still waiting while the second one is unanswered
    answers[0](false);
    await flush();
    expect(waiting()).toBe(1);

    answers[1](false);
    await flush();
    expect(waiting()).toBe(0);
  });

  it('runs an approved view tool call on this machine for local servers', async () => {
    confirmAppToolCall.mockResolvedValue(true);
    invokeMcpToolCall.mockResolvedValue({ content: 'rainy', success: true });
    const { call } = setup();

    await call(1, 'Rome');

    expect(invokeMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'get_forecast', identifier: 'weather-demo' }),
      // On the server, and where, the view came from
      {
        agentId: 'agt_1',
        fromMcpApp: true,
        onThisDevice: true,
        server: 'weather-server',
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('cancels an approved message the view gives up on before it is accepted', async () => {
    confirmAppMessage.mockResolvedValue(true);
    sendMessage.mockImplementation(() => new Promise(() => {}));
    const { fromView, message } = setup();

    await message(1, 'Follow up');
    const { signal } = sendMessage.mock.calls[0][0] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    await fromView({ method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(signal.aborted).toBe(true);
  });

  it('still runs calls that need no approval while a removed view finishes, then ends them', async () => {
    getAppToolCallPolicy.mockResolvedValue('allow');
    invokeMcpToolCall.mockResolvedValue({ content: 'saved', success: true });
    const { call, fromView, response, sent, teardown } = setup();
    await fromView({ method: 'ui/notifications/initialized' });

    const finished = teardown();
    await flush();
    const request = sent().find((m) => m.method === 'ui/resource-teardown');
    expect(request).toBeDefined();

    // The view saves its pending edits before it answers
    await call(7, 'Paris');
    expect(invokeMcpToolCall).toHaveBeenCalledTimes(1);
    const { signal } = invokeMcpToolCall.mock.calls[0][1] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);
    expect(response(7)?.result.isError).toBeFalsy();

    await fromView({ id: request.id, result: {} });
    await finished;

    // Once it finished, nothing it asks for runs any more
    await call(9, 'Rome');
    expect(invokeMcpToolCall).toHaveBeenCalledTimes(1);
  });

  it('cancels an approved message not yet accepted the moment its view starts to go away', async () => {
    confirmAppMessage.mockResolvedValue(true);
    sendMessage.mockImplementation(() => new Promise(() => {}));
    const { fromView, message, teardown } = setup();
    await fromView({ method: 'ui/notifications/initialized' });

    await message(1, 'Follow up');
    const { signal } = sendMessage.mock.calls[0][0] as { signal: AbortSignal };
    void teardown();

    expect(signal.aborted).toBe(true);
  });

  it('drops a prompt the moment its view starts to go away', async () => {
    getAppToolCallPolicy.mockResolvedValue('confirm');
    confirmAppToolCall.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve(false))),
    );
    const { call, fromView, response, teardown } = setup();
    await fromView({ method: 'ui/notifications/initialized' });

    await call(8, 'Rome');
    void teardown();
    await flush();

    expect(invokeMcpToolCall).not.toHaveBeenCalled();
    expect(response(8)?.result.isError).toBe(true);
  });

  it('cancels an approved message before acceptance once the view goes away', async () => {
    confirmAppMessage.mockResolvedValue(true);
    sendMessage.mockImplementation(() => new Promise(() => {}));
    const { dispose, message } = setup();

    await message(1, 'Follow up');
    const { signal } = sendMessage.mock.calls[0][0] as { signal: AbortSignal };

    dispose();
    expect(signal.aborted).toBe(true);
  });

  it('opens a link the view asks for only after the user allows it', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { fromView, response } = setup();
    const link = (id: number) =>
      fromView({ id, method: 'ui/open-link', params: { url: 'https://example.com/?d=sunny' } });

    confirmAppOpenLink.mockResolvedValueOnce(false);
    await link(1);
    expect(confirmAppOpenLink).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Weather Demo', url: 'https://example.com/?d=sunny' }),
    );
    expect(open).not.toHaveBeenCalled();
    expect(response(1)?.result.isError).toBe(true);

    confirmAppOpenLink.mockResolvedValueOnce(true);
    await link(2);
    expect(open).toHaveBeenCalledWith(
      'https://example.com/?d=sunny',
      '_blank',
      'noopener,noreferrer',
    );
    expect(response(2)?.result.isError).toBeUndefined();
  });

  it('asks about one link at a time', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    confirmAppOpenLink.mockImplementation(() => new Promise(() => {}));
    const { fromView, response } = setup();

    await fromView({ id: 1, method: 'ui/open-link', params: { url: 'https://a.example' } });
    await fromView({ id: 2, method: 'ui/open-link', params: { url: 'https://b.example' } });

    expect(confirmAppOpenLink).toHaveBeenCalledTimes(1);
    expect(response(2)?.result.isError).toBe(true);
  });

  it('does not run an allowed call once the view went away while its policy loaded', async () => {
    let decide!: (policy: string) => void;
    getAppToolCallPolicy.mockReturnValue(new Promise((resolve) => (decide = resolve)));
    const { call, dispose } = setup();

    await call(1, 'Rome');
    dispose();
    decide('allow');
    await flush();

    expect(invokeMcpToolCall).not.toHaveBeenCalled();
  });

  it('does not run an allowed call the view cancelled while its policy loaded', async () => {
    let decide!: (policy: string) => void;
    getAppToolCallPolicy.mockReturnValue(new Promise((resolve) => (decide = resolve)));
    const { call, fromView } = setup();

    await call(1, 'Rome');
    await fromView({ method: 'notifications/cancelled', params: { requestId: 1 } });
    decide('allow');
    await flush();

    expect(invokeMcpToolCall).not.toHaveBeenCalled();
  });

  it('cancels a running call once the view goes away', async () => {
    getAppToolCallPolicy.mockResolvedValue('allow');
    invokeMcpToolCall.mockReturnValue(new Promise(() => {}));
    const { call, dispose } = setup();

    await call(1, 'Rome');
    const { signal } = invokeMcpToolCall.mock.calls[0][1] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    dispose();
    expect(signal.aborted).toBe(true);
  });
});
