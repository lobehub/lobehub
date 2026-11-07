import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFetchMcpAppEntrypoint } from './useFetchMcpAppEntrypoint';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  policy: vi.fn(),
}));

// The app's SWR wrappers add workspace scoping only; plain SWR keeps the same cache semantics
vi.mock('@/libs/swr', async () => {
  const swr = await import('swr');
  return {
    mutate: swr.mutate,
    useClientDataSWR: (key: any, fetcher: any, config: any) =>
      swr.default(key, fetcher, { dedupingInterval: 0, ...config }),
  };
});
vi.mock('@/services/mcp', () => ({ mcpService: { invokeMcpToolCall: mocks.invoke } }));
vi.mock('./toolCallPolicy', () => ({ getAppToolCallPolicy: mocks.policy }));

const viewResult = (text: string) => ({
  content: text,
  state: { content: [{ text, type: 'text' }], mcpApp: { resourceUri: 'ui://fixture/thread' } },
  success: true,
});

let instance = 0;
const nextParams = () => {
  instance += 1;
  return {
    agentId: 'agent',
    id: `topic-${instance}:mcp-entry:fixture:open_thread`,
    identifier: 'fixture',
    toolName: 'open_thread',
  };
};

describe('useFetchMcpAppEntrypoint', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.policy.mockReset();
    mocks.policy.mockResolvedValue('allow');
  });

  it('calls the entrypoint tool once with empty arguments', async () => {
    mocks.invoke.mockResolvedValue(viewResult('first'));
    const params = nextParams();

    const { result } = renderHook(() => useFetchMcpAppEntrypoint(params));

    await waitFor(() => expect(result.current.data?.content).toBe('first'));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'open_thread', arguments: '{}', id: params.id }),
      { agentId: 'agent', fromEntrypoint: true },
    );
    expect(mocks.policy).toHaveBeenCalledWith('fixture', 'open_thread', {
      agentId: 'agent',
      fromEntrypoint: true,
    });
  });

  it('opens the app afresh on every mount instead of reusing the last instance', async () => {
    mocks.invoke.mockResolvedValueOnce(viewResult('first'));
    mocks.invoke.mockResolvedValueOnce(viewResult('second'));
    const params = nextParams();

    const first = renderHook(() => useFetchMcpAppEntrypoint(params));
    await waitFor(() => expect(first.result.current.data?.content).toBe('first'));
    first.unmount();

    const second = renderHook(() => useFetchMcpAppEntrypoint(params));
    // The previous instance's result is never shown while the new call runs
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.data?.content).toBe('second'));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('reruns the tool only when asked to, after a failure', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('offline'));
    mocks.invoke.mockResolvedValueOnce(viewResult('retried'));
    const params = nextParams();

    const { result } = renderHook(() => useFetchMcpAppEntrypoint(params));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.mutate();
    });

    await waitFor(() => expect(result.current.data?.content).toBe('retried'));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not call a tool the agent rules deny', async () => {
    mocks.policy.mockResolvedValue('deny');
    const params = nextParams();

    const { result } = renderHook(() => useFetchMcpAppEntrypoint(params));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('fails when the tool result carries no app view', async () => {
    mocks.invoke.mockResolvedValue({ ...viewResult('plain'), state: { content: [] } });
    const params = nextParams();

    const { result } = renderHook(() => useFetchMcpAppEntrypoint(params));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });

  it('does nothing without an entrypoint to open', () => {
    renderHook(() => useFetchMcpAppEntrypoint({ id: 'topic:none' }));

    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
