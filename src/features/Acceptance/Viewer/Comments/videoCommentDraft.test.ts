import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  orderVideoCommentDrafts,
  readVideoCommentDrafts,
  saveVideoCommentDrafts,
  sendVideoCommentDrafts,
} from './videoCommentDraft';

const notes = [1, 4].map((start) => ({
  clientId: `frame-${start}`,
  content: `Comment at ${start}`,
  rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  time: { start },
}));
beforeEach(() => localStorage.clear());

describe('multi-frame video comments', () => {
  it('restores independent anchors and text after revisiting multiple frames', () => {
    saveVideoCommentDrafts('alice:video', notes);
    expect(readVideoCommentDrafts('alice:video')).toEqual(notes);
    expect(readVideoCommentDrafts('bob:video')).toEqual([]);
  });
  it('keeps only unsent drafts and stable retry ids after a partially failed send', async () => {
    let pending = [...notes];
    const remove = (id: string) => {
      pending = pending.filter((note) => note.clientId !== id);
      saveVideoCommentDrafts('video', pending);
    };
    const send = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('offline'));
    await expect(sendVideoCommentDrafts(pending, send, remove)).rejects.toThrow('offline');
    expect(readVideoCommentDrafts('video')).toEqual([notes[1]]);
    const retry = vi.fn().mockResolvedValue(true);
    await sendVideoCommentDrafts(readVideoCommentDrafts('video'), retry, remove);
    expect(retry.mock.calls[0][0]).toEqual(notes[1]);
    expect(readVideoCommentDrafts('video')).toEqual([]);
  });
  it('numbers notes in playing order, keeping drawing order on a shared frame', () => {
    const drawn = [6, 2, 6].map((start, index) => ({
      ...notes[0],
      clientId: `n${index}`,
      time: { start },
    }));
    expect(orderVideoCommentDrafts(drawn).map((note) => note.clientId)).toEqual(['n1', 'n0', 'n2']);
    expect(drawn.map((note) => note.clientId)).toEqual(['n0', 'n1', 'n2']);
  });
});
