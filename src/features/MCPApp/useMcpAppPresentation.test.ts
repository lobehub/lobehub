import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpAppActions } from '@/store/mcpApp/action';
import { initialState, useMcpAppStore } from '@/store/mcpApp/store';

import { useMcpAppPresentation } from './useMcpAppPresentation';

const control = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => control.enabled },
  useServerConfigStore: () => control.enabled,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ openWorkingSidebar: vi.fn() }) },
}));
const options = {
  identifier: 'notes',
  toolCallId: 'call',
  scope: 'topic',
  location: 'inline' as const,
};
beforeEach(() => {
  control.enabled = true;
  useMcpAppStore.setState(initialState);
});
afterEach(() => vi.useRealTimers());
describe('app host lifecycle', () => {
  it('moves ownership and disposes the old bridge immediately during a transfer', () => {
    mcpAppActions.registerPanel('topic');
    const { result } = renderHook(() => useMcpAppPresentation(options));
    act(() => result.current.presentation.onInitialized(['inline', 'fullscreen'], 'inline'));
    expect(result.current.mode).toBe('inline');
    act(() => mcpAppActions.setMode('call', 'fullscreen'));
    expect(result.current.mode).toBe('fullscreen');
    expect(result.current.presentation.retireOnRemove()).toBe(false);
    act(() => result.current.presentation.onTeardown());
    expect(result.current.view?.dismissed).toBe(true);
    act(() => mcpAppActions.close('call'));
    expect(result.current.view?.dismissed).toBe(true);
  });
  it('opens only completed calls observed in the live conversation, once', () => {
    vi.useFakeTimers();
    mcpAppActions.registerPanel('topic');
    const { result } = renderHook(() => useMcpAppPresentation(options));
    act(() => result.current.presentation.onInitialized(['inline', 'fullscreen'], 'fullscreen'));
    act(() => vi.runAllTimers());
    expect(result.current.mode).toBe('inline');
    mcpAppActions.markLive('call');
    act(() => result.current.presentation.onInitialized(['inline', 'fullscreen'], 'fullscreen'));
    act(() => vi.runAllTimers());
    expect(result.current.mode).toBe('fullscreen');
    expect(mcpAppActions.consumeLive('call')).toBe(false);
  });
  it('falls back when an app cannot run inline on an inline-only host', () => {
    const { result } = renderHook(() => useMcpAppPresentation(options));
    expect(result.current.presentation.hostModes).toEqual(['inline']);
    act(() => result.current.presentation.onInitialized([], 'inline'));
    expect(result.current.supported).toBe(false);
    expect(result.current.presentation.retireOnRemove()).toBe(false);
  });
  it('does not register a view with the flag off', () => {
    control.enabled = false;
    const { result } = renderHook(() => useMcpAppPresentation(options));
    expect(result.current.enabled).toBe(false);
    expect(useMcpAppStore.getState().views).toEqual({});
  });
  it('forgets unfinished calls when leaving the conversation', () => {
    mcpAppActions.markLive('call');
    mcpAppActions.forgetLive(['call']);
    expect(mcpAppActions.consumeLive('call')).toBe(false);
  });
});
