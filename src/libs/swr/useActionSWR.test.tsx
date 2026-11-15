/**
 * @vitest-environment happy-dom
 */
import { render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { isActionSWRKey, useActionSWR } from './index';

const action = vi.fn(async () => 'done');

describe('isActionSWRKey', () => {
  it('forgets a key when the hook moves to another key or unmounts', () => {
    const { rerender, unmount } = renderHook(
      ({ model }) => useActionSWR(['download', model], action),
      { initialProps: { model: 'q' } },
    );
    expect(isActionSWRKey(['download', 'q'])).toBe(true);

    rerender({ model: 'qw' });
    expect(isActionSWRKey(['download', 'q'])).toBe(false);
    expect(isActionSWRKey(['download', 'qw'])).toBe(true);

    unmount();
    expect(isActionSWRKey(['download', 'qw'])).toBe(false);
  });

  it('keeps a key until the last hook holding it unmounts', () => {
    const first = renderHook(() => useActionSWR(['shared'], action));
    const second = renderHook(() => useActionSWR(['shared'], action));

    first.unmount();
    expect(isActionSWRKey(['shared'])).toBe(true);

    second.unmount();
    expect(isActionSWRKey(['shared'])).toBe(false);
  });

  it('knows the key by the time layout effects run, when SWR subscribes its revalidator', () => {
    const seen: boolean[] = [];
    const Hook = () => {
      useActionSWR(['early'], action);
      return null;
    };
    const Probe = () => {
      useLayoutEffect(() => {
        seen.push(isActionSWRKey(['early']));
      }, []);
      return null;
    };

    render(
      <>
        <Hook />
        <Probe />
      </>,
    );

    expect(seen).toEqual([true]);
  });
});
