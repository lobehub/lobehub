// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

import type { CommandMenuAnalyticsInput } from './analytics';
import { GLOBAL_SEARCH_EVENTS, useCommandMenuAnalytics } from './analytics';

vi.mock('@lobechat/utils', () => ({ uuid: () => 'search-session-1' }));
vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/libs/analytics/productUsageEvent', () => ({
  trackProductUsageEvent: vi.fn(),
}));

const track = vi.mocked(trackProductUsageEvent);
let currentTime = 0;
let frameId = 0;
let frameCallbacks = new Map<number, FrameRequestCallback>();

const baseInput: CommandMenuAnalyticsInput = {
  enabled: true,
  hasError: false,
  hasResponse: false,
  isValidating: false,
  menuContext: 'general',
  resultCount: 0,
  searchQuery: '',
  typeFilter: undefined,
};

const eventsByName = (name: string) =>
  track.mock.calls.map(([event]) => event).filter((event) => event.name === name);

const flushAnimationFrame = () => {
  act(() => {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    callbacks.forEach((callback) => callback(currentTime));
  });
};

describe('Command menu search analytics', () => {
  beforeEach(() => {
    currentTime = 0;
    frameId = 0;
    frameCallbacks = new Map();
    track.mockReset();
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++frameId;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks an opened search session with bounded surface properties', () => {
    renderHook(() => useCommandMenuAnalytics(baseInput));

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toEqual([
      {
        name: GLOBAL_SEARCH_EVENTS.OPENED,
        properties: {
          menu_context: 'general',
          platform: 'web',
          search_session_id: 'search-session-1',
          spm: 'command_menu.search.opened',
          surface: 'command_menu',
        },
      },
    ]);
  });

  it('opens one search session when a disabled command mode first becomes enabled', () => {
    const { rerender } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: { ...baseInput, enabled: false },
    });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(0);

    rerender({ ...baseInput, enabled: true });
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(1);

    rerender({ ...baseInput, enabled: false });
    rerender({ ...baseInput, enabled: true });
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(1);
  });

  it('measures from the last input through the rendered response without exposing query text', () => {
    const secretQuery = 'private-message-search-text';
    const { rerender, result } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    currentTime = 100;
    act(() => result.current.trackInputChange(secretQuery));
    currentTime = 700;
    rerender({ ...baseInput, isValidating: true, searchQuery: secretQuery });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.QUERY_SETTLED)[0].properties).toMatchObject({
      query_length_bucket: '21-50',
      sequence: 1,
      type_filter: 'all',
    });

    currentTime = 3301;
    rerender({
      ...baseInput,
      hasResponse: true,
      resultCount: 4,
      searchQuery: secretQuery,
    });
    flushAnimationFrame();

    const rendered = eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].properties).toMatchObject({
      duration_bucket: '3s-5s',
      duration_ms: 3201,
      result_count_bucket: '1-5',
      status: 'success',
      visibility_state: 'foreground',
    });

    rerender({
      ...baseInput,
      hasResponse: true,
      resultCount: 5,
      searchQuery: secretQuery,
    });
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED)).toHaveLength(1);
    expect(JSON.stringify(track.mock.calls)).not.toContain(secretQuery);
  });

  it('tracks refinement and result clicks with buckets but no result identifier', () => {
    const { rerender, result, unmount } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    act(() => result.current.trackInputChange('first query'));
    rerender({ ...baseInput, hasResponse: true, resultCount: 8, searchQuery: 'first query' });
    flushAnimationFrame();

    currentTime = 2000;
    act(() => result.current.trackInputChange('second query'));
    rerender({ ...baseInput, isValidating: true, searchQuery: 'second query' });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.REFINED)[0].properties).toMatchObject({
      previous_result_count_bucket: '6-10',
      previous_status: 'success',
      refinement_type: 'query',
    });

    currentTime = 2800;
    rerender({ ...baseInput, hasResponse: true, resultCount: 2, searchQuery: 'second query' });
    flushAnimationFrame();
    currentTime = 3200;
    act(() => result.current.trackResultClick({ position: 2, resultType: 'message' }));

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULT_CLICKED)[0].properties).toMatchObject({
      input_to_click_ms: 1200,
      position_bucket: '2-3',
      position_scope: 'visible_results',
      render_to_click_ms: 400,
      result_type: 'message',
    });

    unmount();
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.ABANDONED)).toHaveLength(0);
    expect(JSON.stringify(track.mock.calls)).not.toContain('result-id');
  });

  it('records pending abandonment but ignores non-search command modes', () => {
    const { rerender, result, unmount } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    act(() => result.current.trackInputChange('unfinished'));
    rerender({ ...baseInput, isValidating: true, searchQuery: 'unfinished' });
    unmount();

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.ABANDONED)[0].properties).toMatchObject({
      last_status: 'pending',
      query_count: 1,
    });

    track.mockClear();
    const disabled = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: { ...baseInput, enabled: false },
    });
    act(() => disabled.result.current.trackInputChange('ask an agent'));
    disabled.rerender({
      ...baseInput,
      enabled: false,
      hasResponse: true,
      resultCount: 1,
      searchQuery: 'ask an agent',
    });
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(0);
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.QUERY_SETTLED)).toHaveLength(0);
  });

  it('keeps the latest pending query when a completed search is cleared before closing', () => {
    const { rerender, result, unmount } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    act(() => result.current.trackInputChange('completed query'));
    rerender({ ...baseInput, hasResponse: true, resultCount: 8, searchQuery: 'completed query' });
    flushAnimationFrame();

    currentTime = 1000;
    act(() => result.current.trackInputChange('pending query'));
    rerender({ ...baseInput, isValidating: true, searchQuery: 'pending query' });

    act(() => result.current.trackInputChange(''));
    rerender(baseInput);
    unmount();

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.ABANDONED)[0].properties).toMatchObject({
      last_result_count_bucket: '0',
      last_status: 'pending',
      query_count: 2,
    });
  });

  it('counts the same query again after the cleared query reaches the search state', () => {
    const { rerender, result } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    act(() => result.current.trackInputChange('same query'));
    rerender({ ...baseInput, hasResponse: true, resultCount: 3, searchQuery: 'same query' });
    flushAnimationFrame();

    act(() => result.current.trackInputChange(''));
    rerender(baseInput);

    currentTime = 1000;
    act(() => result.current.trackInputChange('same query'));
    rerender({ ...baseInput, isValidating: true, searchQuery: 'same query' });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.QUERY_SETTLED)).toHaveLength(2);
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.QUERY_SETTLED)[1].properties).toMatchObject({
      is_refinement: true,
      sequence: 2,
    });
  });

  it('keeps observing an active request after a whitespace-only edit', () => {
    const { rerender, result } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    currentTime = 100;
    act(() => result.current.trackInputChange('same query'));
    currentTime = 700;
    rerender({ ...baseInput, isValidating: true, searchQuery: 'same query' });

    currentTime = 900;
    act(() => result.current.trackInputChange('same query '));
    currentTime = 3400;
    rerender({ ...baseInput, hasResponse: true, resultCount: 3, searchQuery: 'same query' });
    flushAnimationFrame();

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED)).toHaveLength(1);
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED)[0].properties).toMatchObject({
      duration_ms: 3300,
      status: 'success',
    });
  });

  it('records errors and filter refinements with their actual duration boundary', () => {
    const { rerender, result } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: baseInput,
    });

    act(() => result.current.trackInputChange('first query'));
    rerender({ ...baseInput, hasResponse: true, resultCount: 2, searchQuery: 'first query' });
    flushAnimationFrame();

    currentTime = 1000;
    act(() => result.current.trackFilterChange());
    rerender({
      ...baseInput,
      isValidating: true,
      searchQuery: 'first query',
      typeFilter: 'message',
    });

    currentTime = 1800;
    rerender({
      ...baseInput,
      hasError: true,
      searchQuery: 'first query',
      typeFilter: 'message',
    });
    flushAnimationFrame();

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.REFINED)[0].properties).toMatchObject({
      refinement_type: 'filter',
    });
    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED)[1].properties).toMatchObject({
      duration_ms: 800,
      refinement_type: 'filter',
      status: 'error',
    });
  });

  it('starts timing while leaving a disabled command mode', () => {
    const { rerender, result } = renderHook((input) => useCommandMenuAnalytics(input), {
      initialProps: { ...baseInput, enabled: false },
    });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(0);

    currentTime = 100;
    act(() => result.current.trackInputChange('normal search'));
    currentTime = 700;
    rerender({ ...baseInput, enabled: true, isValidating: true, searchQuery: 'normal search' });

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.OPENED)).toHaveLength(1);

    currentTime = 1100;
    rerender({ ...baseInput, enabled: true, hasResponse: true, searchQuery: 'normal search' });
    flushAnimationFrame();

    expect(eventsByName(GLOBAL_SEARCH_EVENTS.RESULTS_RENDERED)[0].properties).toMatchObject({
      duration_ms: 1000,
    });
  });
});
