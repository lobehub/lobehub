/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import McpAppView from './McpAppView';

const { confirmAppMessage, confirmAppToolCall, gesture, invokeMcpToolCall, sendMessage } =
  vi.hoisted(() => ({
    confirmAppMessage: vi.fn(),
    confirmAppToolCall: vi.fn(),
    gesture: { value: false },
    invokeMcpToolCall: vi.fn(),
    sendMessage: vi.fn(),
  }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: {
      contents: [
        {
          _meta: { ui: { permissions: { camera: {}, clipboardWrite: {}, microphone: {} } } },
          mimeType: 'text/html;profile=mcp-app',
          text: '<p>weather</p>',
          uri: 'ui://weather/view',
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({ context: { agentId: 'agt_1' }, sendMessage }),
}));

vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));

vi.mock('@/services/mcp', () => ({ mcpService: { invokeMcpToolCall } }));

vi.mock('@/store/tool', () => ({ getToolStoreState: () => ({}) }));

vi.mock('./appName', () => ({ mcpAppNameSelector: () => () => 'Weather Demo' }));

vi.mock('./confirm', () => ({ confirmAppMessage, confirmAppToolCall }));

vi.mock('./toolCallPolicy', () => ({ getAppToolCallPolicy: () => 'confirm' }));

vi.mock('./userGesture', () => ({
  createViewGestureGate: () => ({ dispose: vi.fn(), takeGestureIn: () => gesture.value }),
}));

const setup = () => {
  const { container } = render(
    <McpAppView
      apiName={'get_weather'}
      arguments={'{"city":"Paris"}'}
      fallback={<div>fallback</div>}
      identifier={'weather-demo'}
      resourceUri={'ui://weather/view'}
      result={{ content: 'sunny' }}
      toolCallId={'call_1'}
    />,
  );
  const iframe = container.querySelector('iframe')!;
  const target = iframe.contentWindow!;
  const posted = vi.spyOn(target, 'postMessage');

  /** Deliver a JSON-RPC message as if the view posted it. */
  const fromView = async (data: Record<string, unknown>) => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', ...data }, source: target }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const response = (id: number) =>
    posted.mock.calls.map(([message]) => message as any).find((message) => message.id === id);
  const message = (id: number, text: string) =>
    fromView({
      id,
      method: 'ui/message',
      params: { content: [{ text, type: 'text' }], role: 'user' },
    });

  return { fromView, iframe, message, response };
};

const setupToolCalls = () => {
  const view = setup();
  const call = (id: number, city: string) =>
    view.fromView({
      id,
      method: 'tools/call',
      params: { arguments: { city }, name: 'get_forecast' },
    });

  return { ...view, call };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('McpAppView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gesture.value = false;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps powerful features off whatever permissions the view declares', () => {
    const { iframe } = setup();
    const allow = iframe.getAttribute('allow')!;

    for (const feature of ['camera', 'microphone', 'geolocation', 'clipboard-write']) {
      expect(allow).toContain(`${feature} 'none'`);
    }
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
  });

  it('sends a message the user just sent from the view', async () => {
    gesture.value = true;
    const { message, response } = setup();

    await message(1, 'What should I wear?');

    expect(confirmAppMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      message: 'What should I wear?',
      metadata: { mcpAppSource: { identifier: 'weather-demo' } },
    });
    expect(response(1)?.result).toEqual({});
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

  it('refuses a second message while one is still pending', async () => {
    let confirmMessage!: (allowed: boolean) => void;
    confirmAppMessage.mockReturnValue(new Promise((resolve) => (confirmMessage = resolve)));
    const { message, response } = setup();

    await message(1, 'first');
    await message(2, 'second');
    expect(response(2)?.result).toEqual({ isError: true });
    expect(confirmAppMessage).toHaveBeenCalledTimes(1);

    confirmMessage(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(response(1)?.result).toEqual({});
  });

  it('shows the app by name and the arguments before a tool call that needs approval', async () => {
    confirmAppToolCall.mockResolvedValue(false);
    const { fromView, response } = setup();

    await fromView({
      id: 1,
      method: 'tools/call',
      params: { arguments: { city: 'Rome' }, name: 'get_forecast' },
    });

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
    const { call, response } = setupToolCalls();

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
    const { call, response } = setupToolCalls();

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

  it('withdraws its pending approvals when the view goes away', async () => {
    confirmAppToolCall.mockReturnValue(new Promise(() => {}));
    const { call } = setupToolCalls();

    await call(1, 'Rome');
    const { signal } = confirmAppToolCall.mock.calls[0][0] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    cleanup();
    expect(signal.aborted).toBe(true);
  });

  it('drops an approval once the view stops waiting for that request', async () => {
    // Like the real confirm: an aborted approval resolves `false`, whatever the user clicks later
    const settle = ({ signal }: { signal: AbortSignal }) =>
      new Promise<boolean>((resolve) =>
        signal.addEventListener('abort', () => resolve(false), { once: true }),
      );
    confirmAppToolCall.mockImplementation(settle);
    confirmAppMessage.mockImplementation(settle);
    const { call, fromView, message } = setupToolCalls();
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
    const { call, fromView } = setupToolCalls();

    await call(1, 'Rome');
    expect(confirmAppToolCall).toHaveBeenCalledTimes(1);
    const { signal } = confirmAppToolCall.mock.calls[0][0] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);

    await fromView({ method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(signal.aborted).toBe(true);
  });

  it('says under the view that it is waiting while its approval is unanswered', async () => {
    const answers: ((allowed: boolean) => void)[] = [];
    confirmAppToolCall.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { call } = setupToolCalls();
    expect(screen.queryByText('mcpApp.waitingApproval')).toBeNull();

    await call(1, 'Rome');
    await call(2, 'Oslo');
    expect(await screen.findByText('mcpApp.waitingApproval')).toBeTruthy();

    // Still waiting while the second one is unanswered
    answers[0](false);
    await flush();
    expect(screen.getByText('mcpApp.waitingApproval')).toBeTruthy();

    answers[1](false);
    await waitFor(() => expect(screen.queryByText('mcpApp.waitingApproval')).toBeNull());
  });

  it('runs an approved view tool call on this machine for local servers', async () => {
    confirmAppToolCall.mockResolvedValue(true);
    invokeMcpToolCall.mockResolvedValue({ content: 'rainy', success: true });
    const { fromView } = setup();

    await fromView({
      id: 1,
      method: 'tools/call',
      params: { arguments: { city: 'Rome' }, name: 'get_forecast' },
    });

    expect(invokeMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'get_forecast', identifier: 'weather-demo' }),
      { agentId: 'agt_1', localHttpOverIpc: true },
    );
  });
});
