import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWindowPasteFile } from './usePasteFile';

const createFileItem = (file: File) => ({
  getAsFile: () => file,
  kind: 'file',
  webkitGetAsEntry: () => null,
});

const createPasteEvent = (items: unknown[]) => {
  const pasteEvent = new Event('paste') as ClipboardEvent;
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: { items },
  });
  return pasteEvent;
};

describe('useWindowPasteFile', () => {
  const file = new File([''], 'test.png', { type: 'image/png' });

  it('uploads files pasted anywhere on the window', async () => {
    const onUploadFiles = vi.fn();
    renderHook(() => useWindowPasteFile(onUploadFiles));

    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
  });

  it('ignores text-only pastes', async () => {
    const onUploadFiles = vi.fn();
    renderHook(() => useWindowPasteFile(onUploadFiles));

    const textItem = { getAsFile: () => null, kind: 'string', webkitGetAsEntry: () => null };
    await act(async () => {
      window.dispatchEvent(createPasteEvent([textItem]));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('ignores paste events without clipboard data', async () => {
    const onUploadFiles = vi.fn();
    renderHook(() => useWindowPasteFile(onUploadFiles));

    await act(async () => {
      window.dispatchEvent(new Event('paste'));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('does not listen while disabled', async () => {
    const onUploadFiles = vi.fn();
    renderHook(() => useWindowPasteFile(onUploadFiles, { disabled: true }));

    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', async () => {
    const onUploadFiles = vi.fn();
    const { unmount } = renderHook(() => useWindowPasteFile(onUploadFiles));
    unmount();

    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('does not prevent default so text still reaches the focused input', async () => {
    const onUploadFiles = vi.fn();
    renderHook(() => useWindowPasteFile(onUploadFiles));

    const pasteEvent = new Event('paste', { cancelable: true }) as ClipboardEvent;
    const textItem = { getAsFile: () => null, kind: 'string', webkitGetAsEntry: () => null };
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [createFileItem(file), textItem] },
    });

    await act(async () => {
      window.dispatchEvent(pasteEvent);
    });

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  it('attaches and detaches as disabled toggles', async () => {
    const onUploadFiles = vi.fn();
    const { rerender } = renderHook(
      ({ disabled }) => useWindowPasteFile(onUploadFiles, { disabled }),
      { initialProps: { disabled: false } },
    );

    rerender({ disabled: true });
    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });
    expect(onUploadFiles).not.toHaveBeenCalled();

    rerender({ disabled: false });
    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback after rerender', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useWindowPasteFile(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    await act(async () => {
      window.dispatchEvent(createPasteEvent([createFileItem(file)]));
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith([file]);
  });
});
