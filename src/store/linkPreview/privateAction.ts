import type { LinkPreview } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { linkPreviewService } from '@/services/linkPreview';
import type { StoreSetter } from '@/store/types';

import { type LinkPreviewState } from './initialState';
import { linkPreviewResource } from './projection';

type Setter = StoreSetter<LinkPreviewState>;

export class LinkPreviewPrivateAction {
  readonly previews;

  constructor(set: Setter, get: () => LinkPreviewState) {
    this.previews = createReplicaSlice(linkPreviewResource, {
      actionPrefix: 'linkPreview',
      fetcher: ({ url }) => linkPreviewService.getPreview(url),
      get,
      // The page has no card (anymore): drop the entry and its persisted row,
      // so a reload stops painting the old one.
      isMissing: (incoming) => !incoming,
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'linkPreviewReplica',
      view: recordLens<LinkPreviewState, LinkPreview>('linkPreviewMap'),
    });
  }
}
