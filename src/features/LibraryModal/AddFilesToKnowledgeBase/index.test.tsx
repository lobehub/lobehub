import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAddFilesToKnowledgeBaseModal } from './index';

const mockCreateModal = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Flexbox: () => null,
  Icon: () => null,
  createModal: mockCreateModal,
  useModalContext: () => ({ close: vi.fn() }),
}));

describe('useAddFilesToKnowledgeBaseModal', () => {
  it('should forward onClose to createModal afterClose', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useAddFilesToKnowledgeBaseModal());

    result.current.open({ fileIds: ['file-1'], onClose });

    expect(mockCreateModal).toHaveBeenCalledWith(expect.objectContaining({ afterClose: onClose }));
  });
});
