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
  });

  it('holds a prose-looking submit and only the confirm control can proceed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() =>
      result.current.handleChange('OPENAI_API_KEY', '绑定到某个第三方服务去做 API 调用'),
    );

    // First Save is held: the sink never sees the values.
    await act(() => result.current.handleSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.proseWarning).toEqual(['OPENAI_API_KEY']);

    // A second ordinary Save / Enter is still held — the explicit confirm
    // control is the only way through.
    await act(() => result.current.handleSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.proseWarning).toEqual(['OPENAI_API_KEY']);

    // The confirm control submits.
    await act(() => result.current.confirmProseSubmit());
    expect(onSubmit).toHaveBeenCalledWith({
      OPENAI_API_KEY: '绑定到某个第三方服务去做 API 调用',
    });
    expect(result.current.proseWarning).toBeUndefined();
  });

  it('confirmProseSubmit approves a held prose submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', 'this sentence was pasted by accident'));

    await act(() => result.current.handleSubmit());
    expect(onSubmit).not.toHaveBeenCalled();

    await act(() => result.current.confirmProseSubmit());
    expect(onSubmit).toHaveBeenCalledWith({
      OPENAI_API_KEY: 'this sentence was pasted by accident',
    });
    expect(result.current.proseWarning).toBeUndefined();
  });

  it('keeps the prose confirmation across a failed submission', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('store unavailable'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', '一段被误粘贴的中文句子'));

    // Confirm via the explicit control; the save fails.
    await act(() => result.current.confirmProseSubmit());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Retry via ordinary Save goes straight to the sink without asking again.
    await act(() => result.current.handleSubmit());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(2, {
      OPENAI_API_KEY: '一段被误粘贴的中文句子',
    });
    expect(result.current.proseWarning).toBeUndefined();
  });

  it('clears the prose warning after a successful confirmed submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', '一段被误粘贴的中文句子'));
    await act(() => result.current.confirmProseSubmit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.proseWarning).toBeUndefined();
  });

  it('clears the prose warning when the user edits the field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', '一段被误粘贴的中文句子'));
    await act(() => result.current.handleSubmit());
    expect(result.current.proseWarning).toEqual(['OPENAI_API_KEY']);

    act(() => result.current.handleChange('OPENAI_API_KEY', 'sk-corrected'));
    expect(result.current.proseWarning).toBeUndefined();

    // The corrected value submits without any hold.
    await act(() => result.current.handleSubmit());
    expect(onSubmit).toHaveBeenCalledWith({ OPENAI_API_KEY: 'sk-corrected' });
  });

  it('does not hold a real token submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSecretInputForm({ fields, onSubmit }));

    act(() => result.current.handleChange('OPENAI_API_KEY', 'sk-yCUC4oGrKNU1BG95jjE2d7ghMtQh6VAE1'));
    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.proseWarning).toBeUndefined();
  });
});
