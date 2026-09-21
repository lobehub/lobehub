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
});
