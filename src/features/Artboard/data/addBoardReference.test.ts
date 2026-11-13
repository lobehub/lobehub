import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions } from '../store';
import { addBoardReference } from './addBoardReference';

const { insert } = vi.hoisted(() => ({ insert: vi.fn(() => true) }));
vi.mock('@/features/ChatInput/InputEditor/ReferArtboard', () => ({
  insertArtboardReference: insert,
}));

const ref = {
  artboardId: 'art_1',
  itemId: 'f1',
  itemTitle: 'A',
  text: 'x',
};

describe('addBoardReference', () => {
  afterEach(() => {
    artboardActions.reset();
    vi.clearAllMocks();
  });

  it('puts the reference into the conversation input by default', () => {
    expect(addBoardReference(ref)).toBe(true);
    expect(insert).toHaveBeenCalledWith(ref);
  });

  it('refuses while the board is opened from Works, where there is no conversation input', () => {
    artboardActions.setGallery(true);

    expect(addBoardReference(ref)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
