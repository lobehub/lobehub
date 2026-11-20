import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type FeishuCreatedApp, useCreatedAppSave } from './useCreatedAppSave';

const app: FeishuCreatedApp = { appId: 'cli_123', appSecret: 'secret-1', brand: 'feishu' };

describe('useCreatedAppSave', () => {
  it('keeps the created credentials when saving fails and clears them once a retry saves', async () => {
    const onCreated = vi
      .fn()
      .mockRejectedValueOnce(new Error('Saving failed'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useCreatedAppSave({ fallbackMessage: 'fallback', onCreated, platform: 'feishu' }),
    );

    await act(() => result.current.save(app));
    expect(result.current.unsaved).toEqual({ app, canRetry: true, message: 'Saving failed' });

    await act(() => result.current.save(result.current.unsaved!.app));
    expect(onCreated).toHaveBeenNthCalledWith(2, app);
    expect(result.current.unsaved).toBeUndefined();
    expect(result.current.saving).toBe(false);
  });

  it('offers no retry for an app from the other brand and falls back to the default message', async () => {
    const onCreated = vi.fn().mockRejectedValue(undefined);
    const { result } = renderHook(() =>
      useCreatedAppSave({ fallbackMessage: 'fallback', onCreated, platform: 'feishu' }),
    );

    await act(() => result.current.save({ ...app, brand: 'lark' }));
    expect(result.current.unsaved).toMatchObject({ canRetry: false, message: 'fallback' });
  });
});
