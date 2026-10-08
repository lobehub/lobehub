import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRejectReview } from './useRejectReview';

vi.mock('@lobehub/ui/base-ui', () => ({
  useModalContext: () => ({ close: vi.fn(), setCanDismissByClickOutside: vi.fn() }),
}));

vi.mock('../Evidence/attachments', () => ({
  useFeedbackAttachments: () => ({
    attachments: [],
    fileIds: [],
    handlePaste: vi.fn(),
    remove: vi.fn(),
    uploadFiles: vi.fn(),
    uploading: false,
  }),
}));

const rect = { height: 0.2, width: 0.3, x: 0.1, y: 0.1 };
const image = { fileUrl: 'shot.png', id: 'shot' };
const video = { fileUrl: 'clip.mp4', id: 'clip', type: 'video' };
const imageNote = { comment: 'faint', evidenceId: 'shot', rect };
const videoNote = { comment: 'skeleton', evidenceId: 'clip', rect, time: { start: 7.2 } };

describe('useRejectReview', () => {
  // A reject replaces the whole decision detail: a layout that cannot edit
  // videos (the phone) must still send their notes back, or they are deleted.
  it('submits notes on evidence it cannot edit, and shows only the editable ones', async () => {
    const onConfirm = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useRejectReview({
        evidence: [image],
        keptEvidence: [video],
        onConfirm,
        previousAnnotations: [imageNote, videoNote],
        previousComment: 'see notes',
      }),
    );

    expect(result.current.editableAnnotations.map((note) => note.evidenceId)).toEqual(['shot']);

    await act(async () => {
      await result.current.submitReject();
    });

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        annotations: [
          { comment: 'faint', evidenceId: 'shot', rect },
          { comment: 'skeleton', evidenceId: 'clip', rect, time: { start: 7.2 } },
        ],
      }),
    );
  });
});
