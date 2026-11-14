import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpAppActions } from '@/store/mcpApp/action';
import { useMcpAppStore } from '@/store/mcpApp/store';

import { openMcpAppEntrypoint } from './openEntrypoint';

const mocks = vi.hoisted(() => ({
  enabled: true,
  invoke: vi.fn(),
  policy: vi.fn(),
}));

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => mocks.enabled },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ openWorkingSidebar: vi.fn() }) },
}));
vi.mock('@/services/mcp', () => ({ mcpService: { invokeMcpToolCall: mocks.invoke } }));
vi.mock('./toolCallPolicy', () => ({ getAppToolCallPolicy: mocks.policy }));

const viewResult = (text: string) => ({
  content: text,
  state: { content: [{ text, type: 'text' }], mcpApp: { resourceUri: 'ui://fixture/thread' } },
  success: true,
});
const call = {
  agentId: 'agent',
  id: 'topic:mcp-entry:fixture:open_thread',
  identifier: 'fixture',
  toolName: 'open_thread',
};
const entry = () => useMcpAppStore.getState().entries[call.id];

beforeEach(() => {
  mcpAppActions.reset();
  mocks.enabled = true;
  mocks.invoke.mockReset();
  mocks.policy.mockReset();
  mocks.policy.mockResolvedValue('allow');
});

describe('openMcpAppEntrypoint', () => {
  it('calls the entrypoint tool once with empty arguments and keeps its view', async () => {
    mocks.invoke.mockResolvedValue(viewResult('first'));

    await openMcpAppEntrypoint(call);

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'open_thread', arguments: '{}', id: call.id }),
      { agentId: 'agent', fromEntrypoint: true },
    );
    expect(mocks.policy).toHaveBeenCalledWith('fixture', 'open_thread', {
      agentId: 'agent',
      fromEntrypoint: true,
    });
    expect(entry()).toMatchObject({ result: { content: 'first' }, status: 'ready' });
  });

  it('shows the tab as opening until the call answers', async () => {
    let answer!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const opening = openMcpAppEntrypoint(call);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    expect(entry()?.status).toBe('opening');

    answer(viewResult('done'));
    await opening;
    expect(entry()?.status).toBe('ready');
  });

  it('keeps the newest open when an older call answers late', async () => {
    let answerFirst!: (value: unknown) => void;
    mocks.invoke.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    mocks.invoke.mockResolvedValueOnce(viewResult('second'));

    const first = openMcpAppEntrypoint(call);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    await openMcpAppEntrypoint(call);
    answerFirst(viewResult('first'));
    await first;

    expect(entry()?.result?.content).toBe('second');
  });

  it('ignores a call that answers after its tab was closed and reopened', async () => {
    let failOld!: (error: Error) => void;
    mocks.invoke.mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)));
    mocks.invoke.mockResolvedValueOnce(viewResult('reopened'));

    const old = openMcpAppEntrypoint(call);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    mcpAppActions.forgetEntries([call.id]);
    await openMcpAppEntrypoint(call);
    failOld(new Error('late failure'));
    await old;

    expect(entry()).toMatchObject({ result: { content: 'reopened' }, status: 'ready' });
  });

  it('marks the tab failed so Retry can open it again', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('offline'));
    mocks.invoke.mockResolvedValueOnce(viewResult('retried'));

    await openMcpAppEntrypoint(call);
    expect(entry()?.status).toBe('error');

    await openMcpAppEntrypoint(call);
    expect(entry()).toMatchObject({ result: { content: 'retried' }, status: 'ready' });
  });

  it('does not call a tool the agent rules deny', async () => {
    mocks.policy.mockResolvedValue('deny');

    await openMcpAppEntrypoint(call);

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(entry()?.status).toBe('error');
  });

  it('fails when the tool result carries no app view', async () => {
    mocks.invoke.mockResolvedValue({ ...viewResult('plain'), state: { content: [] } });

    await openMcpAppEntrypoint(call);

    expect(entry()).toMatchObject({ status: 'error' });
    expect(entry()?.result).toBeUndefined();
  });

  it('forgets a closed tab, so opening it again calls the tool afresh', async () => {
    mocks.invoke.mockResolvedValue(viewResult('first'));
    await openMcpAppEntrypoint(call);

    mcpAppActions.forgetEntries([call.id]);

    expect(entry()).toBeUndefined();
  });

  it('does nothing with the flag off', async () => {
    mocks.enabled = false;

    await openMcpAppEntrypoint(call);

    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });
});
