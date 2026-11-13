import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions, useArtboardStore } from '../store';
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

  it('collects it in the gallery composer while the board is opened from Works', () => {
    artboardActions.setGallery({ agentId: 'agt_1', topicId: 'tpc_1' });
    artboardActions.bindBoard('art_1');

    addBoardReference(ref);

    expect(insert).not.toHaveBeenCalled();
    expect(useArtboardStore.getState().galleryRefs).toEqual([ref]);
  });
});
