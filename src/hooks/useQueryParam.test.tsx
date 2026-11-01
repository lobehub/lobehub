/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { parseAsInteger, parseAsString, useQueryStates } from './useQueryParam';

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

const renderPagination = () =>
  renderHook(
    () => ({
      pagination: useQueryStates(
        {
          current: parseAsInteger.withDefault(1),
          pageSize: parseAsInteger.withDefault(5),
        },
        { clearOnDefault: true },
      ),
      search: useLocation().search,
    }),
    { wrapper },
  );

describe('useQueryStates', () => {
  it('reads defaults when the params are absent', () => {
    const { result } = renderPagination();

    expect(result.current.pagination[0]).toEqual({ current: 1, pageSize: 5 });
  });

  it('writes every param in a single navigation', () => {
    const { result } = renderPagination();

    // The page moves while the size stays at its default. Two separate setters
    // would each rebuild the URL from the params captured before the other one
    // navigated, so the page silently lost the race.
    act(() => result.current.pagination[1]({ current: 3, pageSize: 5 }));

    expect(result.current.pagination[0]).toEqual({ current: 3, pageSize: 5 });
    expect(result.current.search).toBe('?current=3');
  });

  it('drops params that are back at their default when clearOnDefault is set', () => {
    const { result } = renderPagination();

    act(() => result.current.pagination[1]({ current: 3, pageSize: 20 }));
    act(() => result.current.pagination[1]({ current: 1, pageSize: 5 }));

    expect(result.current.search).toBe('');
  });

  it('leaves params it was not given alone', () => {
    const { result } = renderPagination();

    act(() => result.current.pagination[1]({ current: 2, pageSize: 20 }));
    act(() => result.current.pagination[1]({ pageSize: 50 }));

    expect(result.current.pagination[0]).toEqual({ current: 2, pageSize: 50 });
  });

  it('hands the updater the current values', () => {
    const { result } = renderPagination();

    act(() => result.current.pagination[1]({ current: 2 }));
    act(() => result.current.pagination[1](({ current }) => ({ current: current + 1 })));

    expect(result.current.pagination[0].current).toBe(3);
  });

  it('removes a param when its value serializes to null', () => {
    const { result } = renderHook(
      () => ({
        state: useQueryStates({ q: parseAsString }),
        search: useLocation().search,
      }),
      { wrapper },
    );

    act(() => result.current.state[1]({ q: 'lobe' }));
    expect(result.current.search).toBe('?q=lobe');

    act(() => result.current.state[1]({ q: null }));
    expect(result.current.search).toBe('');
  });
});
