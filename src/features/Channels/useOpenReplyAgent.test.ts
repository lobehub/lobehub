import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as workspace from '@/business/client/hooks/useActiveWorkspaceSlug';

import { useOpenReplyAgent } from './useOpenReplyAgent';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ['/channels/chn_1'] }, children);

afterEach(() => vi.restoreAllMocks());

describe('useOpenReplyAgent', () => {
  it.each([
    [null, '/agent/agt_1/profile'],
    ['acme', '/acme/agent/agt_1/profile'],
  ])('opens the profile rather than a blank chat in workspace %s', (slug, destination) => {
    vi.spyOn(workspace, 'getActiveWorkspaceSlug').mockReturnValue(slug);
    let pathnameWhenClosed: string | undefined;
    const close = vi.fn(() => {
      pathnameWhenClosed = result.current.pathname;
    });
    const { result } = renderHook(
      () => ({ open: useOpenReplyAgent('agt_1', close), pathname: useLocation().pathname }),
      { wrapper },
    );

    act(() => result.current.open());

    expect(close).toHaveBeenCalledOnce();
    expect(pathnameWhenClosed).toBe('/channels/chn_1');
    expect(result.current.pathname).toBe(destination);
  });

  it.each([null, undefined, ''])('does not navigate when the Agent is unavailable (%s)', (id) => {
    const close = vi.fn();
    const { result } = renderHook(
      () => ({ open: useOpenReplyAgent(id, close), pathname: useLocation().pathname }),
      { wrapper },
    );

    act(() => result.current.open());

    expect(close).not.toHaveBeenCalled();
    expect(result.current.pathname).toBe('/channels/chn_1');
  });
});
