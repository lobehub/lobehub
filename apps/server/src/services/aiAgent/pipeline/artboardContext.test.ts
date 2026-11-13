// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildArtboardCommentsPrompt } from './artboardContext';

const mocks = vi.hoisted(() => ({ unreadCommentNotices: vi.fn() }));

vi.mock('@/server/services/artboard', () => ({
  ArtboardService: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

const deps = { db: {} as never, userId: 'user-1' };

describe('buildArtboardCommentsPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names each artboard of the conversation with unread threads and how to read them', async () => {
    mocks.unreadCommentNotices.mockResolvedValue([
      { id: 'art_1', threads: 3, title: '导出话题' },
      { id: 'art_2', threads: 1, title: '设置页' },
    ]);

    const prompt = await buildArtboardCommentsPrompt(deps, 'proj-1', 'tpc-1');

    expect(mocks.unreadCommentNotices).toHaveBeenCalledWith('proj-1', 'tpc-1');
    expect(prompt).toContain('<artboard_comments>');
    expect(prompt).toContain('art_1 "导出话题": 3 unread comment threads');
    expect(prompt).toContain('art_2 "设置页": 1 unread comment thread');
    expect(prompt).toContain('listArtboardComments');
  });

  it('adds nothing when no thread is unread, outside a project, or when the read fails', async () => {
    mocks.unreadCommentNotices.mockResolvedValue([]);
    expect(await buildArtboardCommentsPrompt(deps, 'proj-1', 'tpc-1')).toBeUndefined();
    expect(await buildArtboardCommentsPrompt(deps, undefined, 'tpc-1')).toBeUndefined();
    expect(await buildArtboardCommentsPrompt(deps, 'proj-1', undefined)).toBeUndefined();

    mocks.unreadCommentNotices.mockRejectedValue(new Error('db down'));
    expect(await buildArtboardCommentsPrompt(deps, 'proj-1', 'tpc-1')).toBeUndefined();
  });
});
