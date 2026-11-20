import type { ArtboardPublishSnapshot } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { artboardActions, useArtboardStore } from '@/features/Artboard/store';

import { initViewerStore } from './viewerState';

const snapshot = (extra: Partial<ArtboardPublishSnapshot>) =>
  ({
    boards: [],
    edges: [],
    groups: [],
    pages: [],
    rounds: [],
    ...extra,
  }) as ArtboardPublishSnapshot;

describe('initViewerStore', () => {
  beforeEach(() => artboardActions.setOutlineOpen(false));

  // The viewport only keeps boards clear of the outline panel when the store says it is open,
  // so a viewer that shows the outline must open it there before the first fit.
  it('opens the outline for a snapshot that has groups', () => {
    initViewerStore(snapshot({ groups: [{ id: 'grp_1' }] as ArtboardPublishSnapshot['groups'] }));

    expect(useArtboardStore.getState().outlineOpen).toBe(true);
  });

  it('opens the outline for a snapshot with several pages', () => {
    initViewerStore(
      snapshot({ pages: [{ id: 'pg_1' }, { id: 'pg_2' }] as ArtboardPublishSnapshot['pages'] }),
    );

    expect(useArtboardStore.getState().outlineOpen).toBe(true);
  });

  it('keeps the outline closed for a single ungrouped page', () => {
    initViewerStore(snapshot({ pages: [{ id: 'pg_1' }] as ArtboardPublishSnapshot['pages'] }));

    expect(useArtboardStore.getState().outlineOpen).toBe(false);
  });
});
