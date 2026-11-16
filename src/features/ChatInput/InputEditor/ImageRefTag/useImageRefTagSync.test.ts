import { describe, expect, it, vi } from 'vitest';

import type { UploadFileItem } from '@/types/files/upload';

import { planImageRefSync } from './useImageRefTagSync';

vi.mock('@/features/ChatInput/hooks/useChatInputUpload', () => ({
  useChatInputUploadKey: () => 'key',
}));

const upload = (
  previewUrl: string,
  status: UploadFileItem['status'],
  type = 'image/png',
): UploadFileItem =>
  ({
    file: new File(['x'], 'image.png', { type }),
    id: 'image.png',
    previewUrl,
    status,
  }) as UploadFileItem;

describe('planImageRefSync', () => {
  it('adopts the images already attached when the composer mounts', () => {
    const { payload } = planImageRefSync([upload('blob:a', 'pending')], 'topic-a', null);

    expect(payload.insert).toBeUndefined();
    expect(payload.removed).toBeUndefined();
  });

  it('inserts references for images that just started uploading, in attachment order', () => {
    const { state } = planImageRefSync([], 'topic-a', null);
    const files = [upload('blob:a', 'pending'), upload('blob:b', 'uploading')];

    expect(planImageRefSync(files, 'topic-a', state).payload.insert).toEqual(['blob:a', 'blob:b']);
  });

  it('still removes and renumbers references when new ones are not inserted (mobile)', () => {
    const mobile = { insertNew: false };
    const { state } = planImageRefSync(
      [upload('blob:a', 'success'), upload('blob:b', 'success')],
      'topic-a',
      null,
      mobile,
    );
    const files = [upload('blob:b', 'success'), upload('blob:new', 'pending')];

    const { payload } = planImageRefSync(files, 'topic-a', state, mobile);

    expect(payload.insert).toEqual([]);
    expect(payload.removed).toEqual(['blob:a']);
    expect(payload.refs.get('blob:b')?.number).toBe(1);
  });

  it('does not reference attachments restored from a message or seen before', () => {
    const { state } = planImageRefSync([upload('blob:seen', 'pending')], 'topic-a', null);
    const files = [
      upload('blob:seen', 'success'),
      upload('blob:restored', 'success'),
      upload('blob:new', 'pending'),
    ];

    expect(planImageRefSync(files, 'topic-a', state).payload.insert).toEqual(['blob:new']);
  });

  it('removes references only for images removed from the same list', () => {
    const { state } = planImageRefSync(
      [upload('blob:a', 'success'), upload('blob:b', 'success')],
      'topic-a',
      null,
    );

    const sameList = planImageRefSync([upload('blob:b', 'success')], 'topic-a', state);
    expect(sameList.payload.removed).toEqual(['blob:a']);
    expect(sameList.payload.refs.get('blob:b')?.number).toBe(1);

    // Switching conversations leaves the restored draft's references alone.
    const otherList = planImageRefSync([], 'topic-b', state);
    expect(otherList.payload.removed).toBeUndefined();
  });

  it('drops the references of an image whose upload failed', () => {
    const { state } = planImageRefSync([upload('blob:a', 'uploading')], 'topic-a', null);

    expect(planImageRefSync([upload('blob:a', 'error')], 'topic-a', state).payload.removed).toEqual(
      ['blob:a'],
    );
  });
});
