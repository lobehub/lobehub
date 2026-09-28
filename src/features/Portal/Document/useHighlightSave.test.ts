import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { portalKeys } from '@/libs/swr/keys';

import { useHighlightSave } from './useHighlightSave';

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

const mockUpdateDocument = vi.hoisted(() => vi.fn());

vi.mock('@/services/document', () => ({
  documentService: { updateDocument: mockUpdateDocument },
}));

const mockInvalidateDocumentMutation = vi.hoisted(() => vi.fn());

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: mockInvalidateDocumentMutation,
}));

const mockMutate = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr', () => ({
  mutate: mockMutate,
}));

describe('useHighlightSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards expectedUpdatedAt from the row it rendered from', async () => {
    const updatedAt = new Date('2024-01-01T00:00:00.000Z');
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-02T00:00:00.000Z' });
    const onSaved = vi.fn();

    const { result } = renderHook(() =>
      useHighlightSave({ content: 'before', documentId: 'doc-1', onSaved, updatedAt }),
    );

    act(() => result.current.handleChange('after'));
    await act(() => result.current.handleSave());

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: 'after',
      expectedUpdatedAt: updatedAt,
      id: 'doc-1',
      saveSource: 'manual',
    });
    expect(onSaved).toHaveBeenCalledWith('after', '2024-01-02T00:00:00.000Z');
  });

  it('omits expectedUpdatedAt when the row has no known version yet', async () => {
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-02T00:00:00.000Z' });
    const onSaved = vi.fn();

    const { result } = renderHook(() =>
      useHighlightSave({ content: 'before', documentId: 'doc-1', onSaved, updatedAt: undefined }),
    );

    act(() => result.current.handleChange('after'));
    await act(() => result.current.handleSave());

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: 'after',
      id: 'doc-1',
      saveSource: 'manual',
    });
  });

  it('pins the next save to the version the previous save committed before the prop catches up', async () => {
    const updatedAt = new Date('2024-01-01T00:00:00.000Z');
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-02T00:00:00.000Z' });
    const onSaved = vi.fn();

    const { result } = renderHook(() =>
      useHighlightSave({ content: 'before', documentId: 'doc-1', onSaved, updatedAt }),
    );

    act(() => result.current.handleChange('after'));
    await act(() => result.current.handleSave());
    act(() => result.current.handleChange('after again'));
    await act(() => result.current.handleSave());

    expect(mockUpdateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'after again',
        expectedUpdatedAt: new Date('2024-01-02T00:00:00.000Z'),
      }),
    );
  });

  it('follows a new updatedAt prop after a save', async () => {
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-02T00:00:00.000Z' });
    const onSaved = vi.fn();

    const { result, rerender } = renderHook(
      ({ updatedAt }: { updatedAt: Date }) =>
        useHighlightSave({ content: 'before', documentId: 'doc-1', onSaved, updatedAt }),
      { initialProps: { updatedAt: new Date('2024-01-01T00:00:00.000Z') } },
    );

    act(() => result.current.handleChange('after'));
    await act(() => result.current.handleSave());
    rerender({ updatedAt: new Date('2024-01-03T00:00:00.000Z') });
    act(() => result.current.handleChange('after again'));
    await act(() => result.current.handleSave());

    expect(mockUpdateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: new Date('2024-01-03T00:00:00.000Z') }),
    );
  });

  it('invalidates the document caches and toasts on CONFLICT', async () => {
    const updatedAt = new Date('2024-01-01T00:00:00.000Z');
    mockUpdateDocument.mockRejectedValue({ data: { code: 'CONFLICT' } });
    const onSaved = vi.fn();

    const { result } = renderHook(() =>
      useHighlightSave({ content: 'before', documentId: 'doc-1', onSaved, updatedAt }),
    );

    act(() => result.current.handleChange('after'));
    await act(() => result.current.handleSave());

    expect(mockInvalidateDocumentMutation).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(mockMutate).toHaveBeenCalledWith(portalKeys.documentHeader('doc-1'));
    expect(toast.error).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.editingValue).toBe('before');
  });
  it('adopts a refreshed remote body instead of submitting the old draft with its version', async () => {
    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useHighlightSave({ ...props, documentId: 'doc-1', onSaved }),
      { initialProps: { content: 'base', updatedAt: new Date('2024-01-01') } },
    );
    act(() => result.current.handleChange('local draft'));
    rerender({ content: 'remote body', updatedAt: new Date('2024-01-02') });
    await act(() => result.current.handleSave());
    expect(result.current.editingValue).toBe('remote body');
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('keeps the draft after a metadata-only remote refresh', async () => {
    const { result, rerender } = renderHook(
      (props) => useHighlightSave({ ...props, documentId: 'doc-1', onSaved: vi.fn() }),
      { initialProps: { content: 'base', updatedAt: new Date('2024-01-01') } },
    );
    act(() => result.current.handleChange('local draft'));
    rerender({ content: 'base', updatedAt: new Date('2024-01-02') });
    await act(() => result.current.handleSave());
    expect(mockUpdateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'local draft',
        expectedUpdatedAt: new Date('2024-01-02'),
      }),
    );
  });

  it('serializes overlapping saves and preserves the newest edit', async () => {
    let resolveFirst!: (value: { updatedAt: string }) => void;
    mockUpdateDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-03T00:00:00.000Z' });
    const { result } = renderHook(() =>
      useHighlightSave({
        content: 'base',
        documentId: 'doc-1',
        onSaved: vi.fn(),
        updatedAt: new Date('2024-01-01'),
      }),
    );
    act(() => result.current.handleChange('first'));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.handleChange('second'));
    let second!: Promise<void>;
    act(() => {
      second = result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst({ updatedAt: '2024-01-02T00:00:00.000Z' });
      await Promise.all([first, second]);
    });
    expect(mockUpdateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'second',
        expectedUpdatedAt: new Date('2024-01-02'),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
  it('flushes the latest draft on unmount after an in-flight save', async () => {
    let resolveFirst!: (value: { updatedAt: string }) => void;
    mockUpdateDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mockUpdateDocument.mockResolvedValue({ updatedAt: '2024-01-03T00:00:00.000Z' });
    const { result, unmount } = renderHook(() =>
      useHighlightSave({
        content: 'base',
        documentId: 'doc-1',
        onSaved: vi.fn(),
        updatedAt: new Date('2024-01-01'),
      }),
    );
    act(() => result.current.handleChange('first'));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.handleChange('second'));
    unmount();
    await act(async () => {
      await Promise.resolve();
      resolveFirst({ updatedAt: '2024-01-02T00:00:00.000Z' });
      await first;
      await Promise.resolve();
    });
    expect(mockUpdateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'second',
        expectedUpdatedAt: new Date('2024-01-02'),
      }),
    );
  });

  it('ignores an old conflict after a newer remote row was adopted and edited', async () => {
    let rejectFirst!: (error: unknown) => void;
    mockUpdateDocument.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const { result, rerender } = renderHook(
      (props) => useHighlightSave({ ...props, documentId: 'doc-1', onSaved: vi.fn() }),
      { initialProps: { content: 'base', updatedAt: new Date('2024-01-01') } },
    );
    act(() => result.current.handleChange('old draft'));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ content: 'remote', updatedAt: new Date('2024-01-02') });
    act(() => result.current.handleChange('new remote draft'));
    await act(async () => {
      rejectFirst({ data: { code: 'CONFLICT' } });
      await first;
    });
    expect(result.current.editingValue).toBe('new remote draft');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
