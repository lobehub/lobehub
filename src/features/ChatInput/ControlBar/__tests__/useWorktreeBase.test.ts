/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorktreeBase } from '../useWorktreeBase';

const resolveMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/git', () => ({ gitService: { resolveGitWorktreeBase: resolveMock } }));
vi.mock('ahooks', () => ({ useDebounce: <T>(value: T) => value }));

const headBase = { detached: false, ref: 'feat/source', sha: 'aaaaaaaabbbb' };
const mainBase = { detached: false, ref: 'main', sha: 'ccccccccdddd' };

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const render = (initial?: string) =>
  renderHook(({ edited }) => useWorktreeBase('device', '/repo', edited), {
    initialProps: { edited: initial },
    wrapper,
  });

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockImplementation(async ({ baseRef }: { baseRef?: string }) => {
    if (!baseRef) return { base: headBase, success: true };
    if (baseRef === 'main') return { base: mainBase, success: true };
    return { error: `Unknown base ref: ${baseRef}`, success: false };
  });
});

describe('useWorktreeBase', () => {
  it('holds submission until the source HEAD is read, then sends no ref', async () => {
    const { result } = render();

    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.headBase).toEqual(headBase));
    expect(result.current).toMatchObject({ base: headBase, isInvalid: false, isPending: false });
    expect(result.current.ref).toBeUndefined();
  });

  it('sends and resolves a typed ref', async () => {
    const { result } = render('main');

    await waitFor(() => expect(result.current.base).toEqual(mainBase));
    expect(result.current).toMatchObject({ isInvalid: false, ref: 'main' });
  });

  it('flags a ref the repository does not have', async () => {
    const { result } = render('nope');

    await waitFor(() => expect(result.current.isInvalid).toBe(true));
    expect(result.current.base).toBeUndefined();
  });

  it('treats retyping the default label as no edit', async () => {
    const { result, rerender } = render();
    await waitFor(() => expect(result.current.headBase).toEqual(headBase));

    act(() => rerender({ edited: 'feat/source @aaaaaaaa' }));

    expect(result.current).toMatchObject({ isInvalid: false });
    expect(result.current.ref).toBeUndefined();
  });

  it('leaves creating from HEAD open when the device cannot answer', async () => {
    resolveMock.mockRejectedValue(new Error('unsupported'));
    const { result } = render();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current).toMatchObject({ isInvalid: false, unavailable: true });
    expect(result.current.ref).toBeUndefined();
    expect(result.current.headBase).toBeUndefined();
  });

  it('tells a device that cannot check a typed ref from a missing ref', async () => {
    resolveMock.mockRejectedValue(new Error('unsupported'));
    const { result } = render('main');

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current).toMatchObject({ isInvalid: false, ref: 'main' });
  });
});
