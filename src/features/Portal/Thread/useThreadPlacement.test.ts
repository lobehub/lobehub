/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useThreadPlacement } from './useThreadPlacement';

const mount = (url: string) =>
  renderHook(
    () => ({ location: useLocation(), navigate: useNavigate(), placement: useThreadPlacement() }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children),
    },
  );

const query = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useThreadPlacement', () => {
  /** @example T-2769: "open in main" is one Back-able step, not two racing URL writes. */
  it('moves the side-panel thread to the main area as one entry that Back undoes', async () => {
    const { result } = mount('/agent/agt_1/tpc_a?portalThread=thd_a&mode=single');

    await act(async () => {
      result.current.placement.openInMain('thd_a');
    });

    expect(result.current.location.pathname).toBe('/agent/agt_1/tpc_a');
    expect(query(result.current.location.search)).toEqual({ mode: 'single', thread: 'thd_a' });

    await act(async () => {
      result.current.navigate(-1);
    });

    expect(query(result.current.location.search)).toEqual({
      mode: 'single',
      portalThread: 'thd_a',
    });
  });

  /** @example T-2769: the breadcrumb's topic returns to topic + side panel. */
  it('returns a main-area thread to the side panel over the topic', async () => {
    const { result } = mount('/agent/agt_1/tpc_a?thread=thd_a');

    await act(async () => {
      result.current.placement.backToTopic('thd_a');
    });

    expect(result.current.location.pathname).toBe('/agent/agt_1/tpc_a');
    expect(query(result.current.location.search)).toEqual({ portalThread: 'thd_a' });
  });
});
