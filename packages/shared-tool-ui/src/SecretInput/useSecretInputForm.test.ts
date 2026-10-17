/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSecretInputForm } from './useSecretInputForm';

const fields = ['OPENAI_API_KEY'];

describe('useSecretInputForm', () => {
  it('completes only when every field has a value', () => {
    const { result } = renderHook(() =>
      useSecretInputForm({ fields: ['A', 'B'], onSubmit: vi.fn() }),
    );

    act(() => result.current.handleChange('A', 'a'));
    expect(result.current.complete).toBe(false);

    act(() => result.current.handleChange('B', 'b'));
    expect(result.current.complete).toBe(true);

    act(() => result.current.handleChange('B', ''));
    expect(result.current.complete).toBe(false);
  });

  it('keeps the values after a failed submit so the user can retry', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('store unavailable'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', 'sk-one-time'));
    const formKey = result.current.formKey;

    await act(() => result.current.handleSubmit());

    // The inputs are not remounted and the retry needs no re-entry.
    expect(result.current.formKey).toBe(formKey);
    expect(result.current.complete).toBe(true);

    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenNthCalledWith(2, { OPENAI_API_KEY: 'sk-one-time' });
  });

  it('drops the values after a successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', 'sk-saved'));
    const formKey = result.current.formKey;

    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenCalledWith({ OPENAI_API_KEY: 'sk-saved' });
    expect(result.current.formKey).not.toBe(formKey);
    expect(result.current.complete).toBe(false);

    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenLastCalledWith({ OPENAI_API_KEY: undefined });
  });
});
