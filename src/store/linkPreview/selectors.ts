import type { LinkPreview } from '@lobechat/types';

import type { LinkPreviewState } from './initialState';
import { linkPreviewKey, type LinkPreviewParams } from './projection';

/** One page's card, or `undefined` before it arrives (or when the page has none). */
const getPreview =
  (params?: LinkPreviewParams | null) =>
  (s: LinkPreviewState): LinkPreview | undefined =>
    params ? s.linkPreviewMap[linkPreviewKey(params)] : undefined;

export const linkPreviewSelectors = {
  getPreview,
};
