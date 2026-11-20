import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpAppActions } from '@/store/mcpApp/action';
import { initialState, useMcpAppStore } from '@/store/mcpApp/store';

import { useMcpAppPresentation } from './useMcpAppPresentation';

const control = vi.hoisted(() => ({
  enabled: true,
  open: vi.fn(),
  resource: { isLoading: false, data: undefined as unknown },
}));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => control.enabled },
  useServerConfigStore: () => control.enabled,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ openWorkingSidebar: control.open }) },
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: any) => selector({ useFetchMcpAppResource: () => control.resource }),
}));

const URI = 'ui://fixture/view';
const resourceDeclaring = (openaiUi?: Record<string, unknown>) => ({
  contents: [
    {
      _meta: openaiUi ? { 'openai/ui': openaiUi } : undefined,
      mimeType: 'text/html;profile=mcp-app',
      text: '<p>app</p>',
      uri: URI,
    },
  ],
});
const options = {
  identifier: 'notes',
  location: 'inline' as const,
  resourceUri: URI,
  scope: 'topic',
  toolCallId: 'call',
};
const decide = () => act(() => vi.runAllTimers());

beforeEach(() => {
  vi.useFakeTimers();
  control.enabled = true;
  control.open.mockReset();
  control.resource = { data: resourceDeclaring(), isLoading: false };
  useMcpAppStore.setState(initialState);
});
afterEach(() => vi.useRealTimers());

describe('MCP App placement from declarations', () => {
  it('waits for the resource before deciding, so no frame mounts in the wrong place', () => {
    mcpAppActions.registerPanel('topic');
    control.resource = { data: undefined, isLoading: true };
    const { result, rerender } = renderHook(() =>
      useMcpAppPresentation({ ...options, preferred: 'fullscreen' }),
    );
    decide();
    expect(result.current.placed).toBe(false);

    control.resource = { data: resourceDeclaring(), isLoading: false };
    rerender();
    decide();
    expect(result.current.placed).toBe(true);
    expect(result.current.mode).toBe('fullscreen');
  });

  it("follows the tool's preferred mode over the resource's", () => {
    mcpAppActions.registerPanel('topic');
    control.resource = {
      data: resourceDeclaring({ preferredDisplayMode: 'fullscreen' }),
      isLoading: false,
    };
    const { result } = renderHook(() => useMcpAppPresentation({ ...options, preferred: 'inline' }));
    decide();
    expect(result.current.mode).toBe('inline');
  });

  it("places a view from history by its resource's declaration without opening the panel", () => {
    mcpAppActions.registerPanel('topic');
    control.resource = {
      data: resourceDeclaring({ availableDisplayModes: ['inline', 'fullscreen'] }),
      isLoading: false,
    };
    const { result } = renderHook(() => useMcpAppPresentation(options));
    decide();
    expect(result.current.mode).toBe('fullscreen');
    expect(control.open).not.toHaveBeenCalled();
  });

  it('opens the side panel for a declared fullscreen call completed live', () => {
    mcpAppActions.registerPanel('topic');
    mcpAppActions.markLive('call');
    renderHook(() => useMcpAppPresentation({ ...options, preferred: 'fullscreen' }));
    decide();
    expect(control.open).toHaveBeenCalledWith('mcp-app:call');
  });

  it('keeps a declared fullscreen view in its message where there is no side panel', () => {
    const { result } = renderHook(() =>
      useMcpAppPresentation({ ...options, preferred: 'fullscreen' }),
    );
    decide();
    expect(result.current.presentation.hostModes).toEqual(['inline']);
    expect(result.current.mode).toBe('inline');
  });

  it('keeps a restored side panel tab in the panel whatever the tool first declared', () => {
    mcpAppActions.registerPanel('topic');
    // The app moved itself to the panel before the reload; its message is rendered too
    const inline = renderHook(() => useMcpAppPresentation({ ...options, preferred: 'inline' }));
    renderHook(() =>
      useMcpAppPresentation({ ...options, location: 'fullscreen', preferred: 'inline' }),
    );
    decide();
    expect(inline.result.current.mode).toBe('fullscreen');
    expect(control.open).not.toHaveBeenCalled();
  });

  it('lets the side panel host decide when its tab is restored without the message', () => {
    mcpAppActions.registerPanel('topic');
    const { result } = renderHook(() =>
      useMcpAppPresentation({ ...options, location: 'fullscreen', preferred: 'fullscreen' }),
    );
    decide();
    expect(result.current.mode).toBe('fullscreen');
    expect(control.open).not.toHaveBeenCalled();
  });

  it('moves and ends on the app requests only', () => {
    mcpAppActions.registerPanel('topic');
    const { result } = renderHook(() => useMcpAppPresentation({ ...options, preferred: 'inline' }));
    decide();
    act(() => result.current.presentation.onInitialized(['inline', 'fullscreen'], 'inline'));
    expect(result.current.mode).toBe('inline');

    act(() => {
      result.current.presentation.onMode('fullscreen');
      vi.runAllTimers();
    });
    expect(result.current.mode).toBe('fullscreen');
    expect(result.current.presentation.retireOnRemove()).toBe(false);

    act(() => result.current.presentation.onTeardown());
    expect(result.current.view?.dismissed).toBe(true);
  });

  it("ignores a replaced panel frame's late teardown, but not the current one's", () => {
    mcpAppActions.registerPanel('topic');
    const panel = { ...options, location: 'fullscreen' as const, preferred: 'fullscreen' as const };
    const first = renderHook(() => useMcpAppPresentation(panel));
    decide();
    const firstPresentation = first.result.current.presentation;
    // The tab closes while the app saves, then View opens it again
    first.unmount();
    const second = renderHook(() => useMcpAppPresentation(panel));

    act(() => firstPresentation.onTeardown());
    expect(second.result.current.view?.dismissed).toBeFalsy();

    act(() => second.result.current.presentation.onTeardown());
    expect(second.result.current.view?.dismissed).toBe(true);
  });

  it('ends the view when its app leaves and no other frame took over', () => {
    mcpAppActions.registerPanel('topic');
    const { result, unmount } = renderHook(() =>
      useMcpAppPresentation({ ...options, preferred: 'inline' }),
    );
    decide();
    const presentation = result.current.presentation;
    unmount();

    act(() => presentation.onTeardown());

    expect(useMcpAppStore.getState().views.call.dismissed).toBe(true);
  });

  it('falls back when an app cannot run inline on an inline-only host', () => {
    const { result } = renderHook(() => useMcpAppPresentation(options));
    decide();
    act(() => result.current.presentation.onInitialized([], 'inline'));
    expect(result.current.supported).toBe(false);
    expect(result.current.presentation.retireOnRemove()).toBe(false);
  });

  it('does not register or place a view with the flag off', () => {
    control.enabled = false;
    const { result } = renderHook(() =>
      useMcpAppPresentation({ ...options, preferred: 'fullscreen' }),
    );
    decide();
    expect(result.current.enabled).toBe(false);
    expect(useMcpAppStore.getState().views).toEqual({});
  });

  it('forgets unfinished calls when leaving the conversation', () => {
    mcpAppActions.markLive('call');
    mcpAppActions.forgetLive(['call']);
    expect(mcpAppActions.consumeLive('call')).toBe(false);
  });
});
