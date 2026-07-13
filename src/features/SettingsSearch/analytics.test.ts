import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

import { useSettingsSearchAnalytics } from './analytics';
import type { SettingsSearchResult } from './useSettingsSearch';

vi.mock('@/libs/analytics/productUsageEvent', () => ({
  trackProductUsageEvent: vi.fn(),
}));

const trackMock = vi.mocked(trackProductUsageEvent);

const makeResult = (key: string): SettingsSearchResult => ({
  breadcrumb: 'General › Appearance',
  key,
  label: 'Theme',
  tab: 'appearance' as SettingsSearchResult['tab'],
  url: '/settings/appearance',
});

const eventsByName = (name: string) =>
  trackMock.mock.calls.map(([event]) => event).filter((event) => event.name === name);

describe('useSettingsSearchAnalytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear in beforeEach, not afterEach: testing-library's auto-cleanup unmounts
    // hooks AFTER our afterEach, and that unmount can emit an abandoned event
    // which would otherwise leak into the next test's assertions.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a settled query once, skipping intermediate keystrokes', () => {
    const results = [makeResult('tab-general-appearance')];
    const { rerender } = renderHook(({ query }) => useSettingsSearchAnalytics(query, results), {
      initialProps: { query: '图' },
    });

    // Keystroke before the settle timeout should not be reported
    vi.advanceTimersByTime(300);
    rerender({ query: '图片' });
    vi.advanceTimersByTime(1000);

    const queryEvents = eventsByName('settings_search_query');
    expect(queryEvents).toHaveLength(1);
    expect(queryEvents[0].properties).toMatchObject({
      query: '图片',
      result_count: 1,
      sequence: 1,
    });

    // Re-render with the same query must not report a duplicate
    rerender({ query: '图片' });
    vi.advanceTimersByTime(1000);
    expect(eventsByName('settings_search_query')).toHaveLength(1);
  });

  it('reports result clicks with type and 1-based position', () => {
    const results = [makeResult('tab-general-appearance'), makeResult('item-appearance-theme')];
    const { result } = renderHook(() => useSettingsSearchAnalytics('theme', results));

    result.current.trackResultClick(results[1], 2);

    const clickEvents = eventsByName('settings_search_result_clicked');
    expect(clickEvents).toHaveLength(1);
    expect(clickEvents[0].properties).toMatchObject({
      position: 2,
      query: 'theme',
      result_key: 'item-appearance-theme',
      result_type: 'item',
    });
  });

  it('reports abandonment on unmount without a click, but not after a click', () => {
    const results: SettingsSearchResult[] = [];
    const { unmount } = renderHook(() => useSettingsSearchAnalytics('nonexistent', results));
    vi.advanceTimersByTime(1000);
    unmount();

    const abandonedEvents = eventsByName('settings_search_abandoned');
    expect(abandonedEvents).toHaveLength(1);
    expect(abandonedEvents[0].properties).toMatchObject({
      had_results: false,
      last_query: 'nonexistent',
      query_count: 1,
    });

    trackMock.mockClear();
    const clicked = [makeResult('provider-openai')];
    const { result, unmount: unmountClicked } = renderHook(() =>
      useSettingsSearchAnalytics('openai', clicked),
    );
    vi.advanceTimersByTime(1000);
    result.current.trackResultClick(clicked[0], 1);
    unmountClicked();

    expect(eventsByName('settings_search_abandoned')).toHaveLength(0);
  });

  it('redacts token-like queries but keeps real length metadata', () => {
    const secret = 'sk-proj-Abc123XyzSecretValue';
    const results = [makeResult('tab-system-apikey')];
    const { result } = renderHook(() => useSettingsSearchAnalytics(secret, results));
    vi.advanceTimersByTime(1000);

    const queryEvents = eventsByName('settings_search_query');
    expect(queryEvents).toHaveLength(1);
    expect(queryEvents[0].properties).toMatchObject({
      query: '[redacted]',
      query_length: secret.length,
    });

    result.current.trackResultClick(results[0], 1);
    const clickEvents = eventsByName('settings_search_result_clicked');
    expect(clickEvents[0].properties!.query).toBe('[redacted]');
  });

  it('redacts punctuated secrets like JWTs and base64 tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fwpM';
    renderHook(() => useSettingsSearchAnalytics(jwt, []));
    vi.advanceTimersByTime(1000);

    const queryEvents = eventsByName('settings_search_query');
    expect(queryEvents).toHaveLength(1);
    expect(queryEvents[0].properties).toMatchObject({
      query: '[redacted]',
      query_length: jwt.length,
    });
  });

  it('redacts secrets embedded in surrounding text', () => {
    renderHook(() =>
      useSettingsSearchAnalytics('{"apiKey": "sk-proj-abc123def456"}', [makeResult('tab-a-b')]),
    );
    vi.advanceTimersByTime(1000);

    expect(eventsByName('settings_search_query')[0].properties!.query).toBe('[redacted]');
  });

  it('does not redact hyphenated words containing a prefix substring', () => {
    renderHook(() => useSettingsSearchAnalytics('risk-control settings', [makeResult('tab-a-b')]));
    vi.advanceTimersByTime(1000);

    expect(eventsByName('settings_search_query')[0].properties!.query).toBe(
      'risk-control settings',
    );
  });

  it('does not redact ordinary short queries', () => {
    renderHook(() => useSettingsSearchAnalytics('dark mode', [makeResult('tab-a-b')]));
    vi.advanceTimersByTime(1000);

    expect(eventsByName('settings_search_query')[0].properties!.query).toBe('dark mode');
  });

  it('holds the settle timer while the index is loading and reports the final count', () => {
    const { rerender } = renderHook(
      ({ isIndexing, results }: { isIndexing: boolean; results: SettingsSearchResult[] }) =>
        useSettingsSearchAnalytics('zhuti', results, isIndexing),
      { initialProps: { isIndexing: true, results: [] as SettingsSearchResult[] } },
    );

    // Transient zero-result state during pinyin dict load must not be reported
    vi.advanceTimersByTime(2000);
    expect(eventsByName('settings_search_query')).toHaveLength(0);

    rerender({ isIndexing: false, results: [makeResult('tab-general-appearance')] });
    vi.advanceTimersByTime(1000);

    const queryEvents = eventsByName('settings_search_query');
    expect(queryEvents).toHaveLength(1);
    expect(queryEvents[0].properties).toMatchObject({ query: 'zhuti', result_count: 1 });
  });

  it('does not report abandonment when no query ever settled', () => {
    const { unmount } = renderHook(() => useSettingsSearchAnalytics('a', []));
    // Unmount before the settle timeout — e.g. user cleared input immediately
    vi.advanceTimersByTime(300);
    unmount();

    expect(eventsByName('settings_search_abandoned')).toHaveLength(0);
  });
});
