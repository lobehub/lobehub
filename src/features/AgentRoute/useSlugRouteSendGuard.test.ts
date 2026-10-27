/**
 * @vitest-environment happy-dom
 */
import { toast } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { useAgentStore } from '@/store/agent';

import { checkSendOnSlugRoute, useSlugRouteSendGuard } from './useSlugRouteSendGuard';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: vi.fn(), info: vi.fn() },
}));

const confirmedEntry = { source: 'server' } as any;
const storageEntry = { source: 'storage' } as any;

describe('checkSendOnSlugRoute', () => {
  const confirmAgentSlugTarget = vi.fn();

  beforeEach(() => {
    confirmAgentSlugTarget.mockReset();
    act(() =>
      useAgentStore.setState({
        agentSlugIdMap: {},
        agentSlugIdReplica: createReplicaState(),
        confirmAgentSlugTarget,
      } as any),
    );
  });

  const seed = (agentId: string, entry: unknown) =>
    act(() =>
      useAgentStore.setState({
        agentSlugIdMap: { 'my-writer': agentId },
        agentSlugIdReplica: { ...createReplicaState(), entries: { 'my-writer': entry } } as any,
      }),
    );

  it('never holds an id route or a builtin slug', async () => {
    await expect(checkSendOnSlugRoute('agt_plain')).resolves.toBe('ok');
    await expect(checkSendOnSlugRoute('inbox')).resolves.toBe('ok');
    expect(confirmAgentSlugTarget).not.toHaveBeenCalled();
  });

  it('sends at once when the server already confirmed the slug', async () => {
    seed('agt_writer', confirmedEntry);

    await expect(checkSendOnSlugRoute('my-writer')).resolves.toBe('ok');
    expect(confirmAgentSlugTarget).not.toHaveBeenCalled();
  });

  // Codex P1: the agent painted from the local copy may no longer own the slug.
  it('holds a send to the locally painted agent until the server names that same agent', async () => {
    seed('agt_writer', storageEntry);
    confirmAgentSlugTarget.mockResolvedValue('agt_writer');

    await expect(checkSendOnSlugRoute('my-writer')).resolves.toBe('ok');
    expect(confirmAgentSlugTarget).toHaveBeenCalledWith('my-writer');
  });

  it('blocks the send when the slug moved to another agent', async () => {
    seed('agt_old', storageEntry);
    confirmAgentSlugTarget.mockResolvedValue('agt_new');

    await expect(checkSendOnSlugRoute('my-writer')).resolves.toBe('moved');
  });

  it('blocks the send when the lookup fails or nothing names the slug', async () => {
    seed('agt_writer', storageEntry);
    confirmAgentSlugTarget.mockRejectedValueOnce(new Error('offline'));
    await expect(checkSendOnSlugRoute('my-writer')).resolves.toBe('unconfirmed');

    confirmAgentSlugTarget.mockResolvedValueOnce(undefined);
    await expect(checkSendOnSlugRoute('my-writer')).resolves.toBe('unconfirmed');
  });
});

describe('useSlugRouteSendGuard', () => {
  const confirmAgentSlugTarget = vi.fn();
  const routeWrapper = ({ children }: PropsWithChildren) =>
    createElement(
      MemoryRouter,
      { initialEntries: ['/agent/my-writer'] },
      createElement(Routes, null, createElement(Route, { element: children, path: '/agent/:aid' })),
    );

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    confirmAgentSlugTarget.mockReset();
    act(() =>
      useAgentStore.setState({
        agentSlugIdMap: { 'my-writer': 'agt_writer' },
        agentSlugIdReplica: {
          ...createReplicaState(),
          entries: { 'my-writer': { source: 'storage' } },
        } as any,
        confirmAgentSlugTarget,
      } as any),
    );
  });

  // Codex P2: a held send must say why instead of looking like a dead button.
  it('tells the sender when the slug could not be confirmed', async () => {
    confirmAgentSlugTarget.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSlugRouteSendGuard(), { wrapper: routeWrapper });

    await expect(result.current.onBeforeSendMessage!({} as any)).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('tells the sender the route is switching when the slug moved', async () => {
    confirmAgentSlugTarget.mockResolvedValue('agt_other');
    const { result } = renderHook(() => useSlugRouteSendGuard(), { wrapper: routeWrapper });

    await expect(result.current.onBeforeSendMessage!({} as any)).resolves.toBe(false);
    expect(toast.info).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Codex P1: regenerate and continue start a generation too.
  it('holds regenerate and continue on an unconfirmed slug route as well', async () => {
    confirmAgentSlugTarget.mockResolvedValue('agt_other');
    const { result } = renderHook(() => useSlugRouteSendGuard(), { wrapper: routeWrapper });

    await expect(result.current.onBeforeRegenerate!('msg_1')).resolves.toBe(false);
    await expect(result.current.onBeforeContinue!('msg_1')).resolves.toBe(false);
    expect(confirmAgentSlugTarget).toHaveBeenCalledTimes(2);
  });

  it('lets a confirmed send through silently', async () => {
    confirmAgentSlugTarget.mockResolvedValue('agt_writer');
    const { result } = renderHook(() => useSlugRouteSendGuard(), { wrapper: routeWrapper });

    await expect(result.current.onBeforeSendMessage!({} as any)).resolves.toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
