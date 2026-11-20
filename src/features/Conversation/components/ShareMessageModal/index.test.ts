import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openShareMessageModal } from './index';

const createModal = vi.hoisted(() => vi.fn((_props: { content: ReactElement<any> }) => ({})));
const notifyChunkError = vi.hoisted(() => vi.fn());
// Detection belongs to `@/utils/chunkError` (and its own tests).
const isChunkLoadError = vi.hoisted(() => vi.fn(() => false));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal,
}));
vi.mock('@/utils/chunkError', () => ({ isChunkLoadError, notifyChunkError }));

const modalContent = (call: number) => createModal.mock.calls[call][0].content;
// SafeBoundary > Suspense > the lazily loaded modal body.
const modalBody = (call: number) => modalContent(call).props.children.props.children;

describe('openShareMessageModal', () => {
  beforeEach(() => {
    createModal.mockClear();
    notifyChunkError.mockClear();
    isChunkLoadError.mockReset().mockReturnValue(false);
  });

  it('puts the modal up on click, before its content has loaded', () => {
    openShareMessageModal({ id: 'msg-1' } as any, vi.fn());

    expect(createModal).toHaveBeenCalledTimes(1);
  });

  it('shows each clicked message in its own modal', () => {
    const storeA = vi.fn();
    const storeB = vi.fn();

    openShareMessageModal({ id: 'msg-a' } as any, storeA);
    openShareMessageModal({ id: 'msg-b' } as any, storeB);

    expect(modalBody(0).props).toMatchObject({
      createConversationStore: storeA,
      message: { id: 'msg-a' },
    });
    expect(modalBody(1).props).toMatchObject({
      createConversationStore: storeB,
      message: { id: 'msg-b' },
    });
  });

  it('hands content that failed to load to the chunk recovery', () => {
    isChunkLoadError.mockReturnValue(true);
    openShareMessageModal({ id: 'msg-1' } as any, vi.fn());
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/Content.js');

    modalContent(0).props.onError(error);

    expect(notifyChunkError).toHaveBeenCalledWith(error);
  });

  it('leaves other render errors to the boundary', () => {
    openShareMessageModal({ id: 'msg-1' } as any, vi.fn());

    modalContent(0).props.onError(new Error('modal bug'));

    expect(notifyChunkError).not.toHaveBeenCalled();
  });
});
