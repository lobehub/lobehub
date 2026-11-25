import type { LinkPreview } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export interface LinkPreviewParams {
  url: string;
}

/** Linked pages whose card survives a reload, most recently used first. */
export const MAX_PERSISTED_LINK_PREVIEWS = 100;

/**
 * Entry key: `link/<url>`. The prefix keeps the replica sync key clear of the
 * retired per-domain cache prefixes, which would persist the response twice.
 */
export const linkPreviewKey = ({ url }: LinkPreviewParams) => `link/${url}`;

/**
 * Open Graph cards of the pages messages link (`linkPreviewMap[key]`).
 * localStorage, so a reload paints the card in the mount microtask instead of
 * letting the message grow under the reader. Cards are compact and LRU-capped.
 */
export const linkPreviewResource = defineReplica<
  LinkPreviewParams,
  LinkPreview,
  LinkPreview | null
>({
  key: linkPreviewKey,
  name: 'linkPreview',
  persist: { maxEntries: MAX_PERSISTED_LINK_PREVIEWS },
  storage: 'localStorage',
  version: 1,
});
