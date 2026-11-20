import type { ArtboardPublishSnapshot } from '@lobechat/types';

import { artboardActions } from '@/features/Artboard/store';

/**
 * Seed the shared Artboard store before the first render. The viewport fits the
 * boards clear of the outline panel only while the store has it open, so the
 * outline the viewer shows must be opened here, not just rendered.
 */
export const initViewerStore = (snapshot: ArtboardPublishSnapshot) => {
  artboardActions.setOutlineOpen(snapshot.pages.length > 1 || snapshot.groups.length > 0);
};
