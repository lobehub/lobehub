import { describe, expect, it, vi } from 'vitest';

import { getValidTopicPreview } from '@/services/message/topicPreview';

import { hasReadingPositionSnapshot } from '../../utils/scrollSnapshotStore';
import { resolveTopicPreview } from './resolveTopicPreview';

vi.mock('@/services/message/topicPreview', () => ({ getValidTopicPreview: vi.fn() }));
vi.mock('../../utils/scrollSnapshotStore', () => ({ hasReadingPositionSnapshot: vi.fn() }));

const cached = { message: { id: 'msg_final' } };

describe('resolveTopicPreview', () => {
  it('returns the cached preview for an unchanged, idle topic', () => {
    vi.mocked(getValidTopicPreview).mockReturnValueOnce(cached as any);
    vi.mocked(hasReadingPositionSnapshot).mockReturnValueOnce(false);

    expect(
      resolveTopicPreview({
        contextKey: 'main_agt_1_tpc_a',
        running: false,
        topicId: 'tpc_a',
        topicUpdatedAt: '2026-10-27T00:00:00.000Z',
      }),
    ).toBe(cached);
    expect(getValidTopicPreview).toHaveBeenCalledWith('tpc_a', {
      running: false,
      topicUpdatedAt: '2026-10-27T00:00:00.000Z',
    });
  });

  it('opens without a preview when the reader left a reading position', () => {
    vi.mocked(getValidTopicPreview).mockReturnValueOnce(cached as any);
    vi.mocked(hasReadingPositionSnapshot).mockReturnValueOnce(true);

    expect(
      resolveTopicPreview({ contextKey: 'k', running: false, topicId: 'tpc_a', topicUpdatedAt: 1 }),
    ).toBeUndefined();
  });

  it('has no preview for a new conversation', () => {
    expect(resolveTopicPreview({ contextKey: 'k', running: false, topicId: null })).toBeUndefined();
  });
});
