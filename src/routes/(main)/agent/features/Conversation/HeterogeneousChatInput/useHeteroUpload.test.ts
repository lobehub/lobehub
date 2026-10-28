import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeteroUpload } from './useHeteroUpload';

const mocks = vi.hoisted(() => ({
  editor: { focus: vi.fn() },
  routeLargeFiles: vi.fn((files: File[]) => files),
  toastError: vi.fn(),
  upload: vi.fn(),
  validateVideoFileSize: vi.fn(() => ({ isValid: true }) as Record<string, unknown>),
}));

vi.mock('@lobechat/utils/client', () => ({
  validateVideoFileSize: mocks.validateVideoFileSize,
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({ useAgentId: () => 'agt_hetero' }));

vi.mock('@/features/ChatInput/hooks/useLargeFileLocalPath', () => ({
  useLargeFileLocalPath: () => mocks.routeLargeFiles,
}));

vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (selector: (s: any) => unknown) => selector({ editor: mocks.editor }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: any) => unknown) => selector({ uploadChatFiles: mocks.upload }),
}));

describe('useHeteroUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads picked files to the chat upload list for the hetero agent', async () => {
    const onPicked = vi.fn();
    const { result } = renderHook(() => useHeteroUpload('claude-code', onPicked));
    const files = [new File(['x'], 'shot.png', { type: 'image/png' })];

    await act(() => result.current.onFiles(files));

    expect(onPicked).toHaveBeenCalled();
    expect(mocks.editor.focus).toHaveBeenCalled();
    expect(mocks.routeLargeFiles).toHaveBeenCalledWith(files);
    expect(mocks.upload).toHaveBeenCalledWith(files, 'agt_hetero');
  });

  it('skips the upload when every picked file became a local-path reference', async () => {
    mocks.routeLargeFiles.mockReturnValueOnce([]);
    const { result } = renderHook(() => useHeteroUpload('claude-code', vi.fn()));

    await act(() => result.current.onFiles([new File(['x'], 'big.csv', { type: 'text/csv' })]));

    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects images for a text-only adapter with a toast', () => {
    const { result } = renderHook(() => useHeteroUpload('cursor', vi.fn()));

    expect(result.current.beforeUpload(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(
      false,
    );
    expect(mocks.toastError).toHaveBeenCalled();
    // Non-image files still go through as download links.
    expect(result.current.beforeUpload(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(
      true,
    );
  });

  it('accepts images for an adapter that reads them', () => {
    const { result } = renderHook(() => useHeteroUpload('claude-code', vi.fn()));

    expect(result.current.beforeUpload(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true);
  });

  it('rejects an oversized video with a toast', () => {
    mocks.validateVideoFileSize.mockReturnValueOnce({
      actualSize: '30 MB',
      isValid: false,
      maxSize: '20 MB',
    });
    const { result } = renderHook(() => useHeteroUpload('claude-code', vi.fn()));

    expect(result.current.beforeUpload(new File(['x'], 'a.mp4', { type: 'video/mp4' }))).toBe(
      false,
    );
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
