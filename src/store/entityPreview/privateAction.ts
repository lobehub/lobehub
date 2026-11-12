import isEqual from 'fast-deep-equal';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';

import { fetchEntityPreview } from './fetchEntityPreview';
import { type EntityPreviewState } from './initialState';
import { type EntityPreview, entityPreviewResource } from './projection';

type Setter = StoreSetter<EntityPreviewState>;

export class EntityPreviewPrivateAction {
  readonly previews;

  constructor(set: Setter, get: () => EntityPreviewState) {
    this.previews = createReplicaSlice(entityPreviewResource, {
      actionPrefix: 'entityPreview',
      fetcher: fetchEntityPreview,
      get,
      // The entity is gone or no longer visible: drop the entry and its
      // persisted row, so a reload stops titling the link with it.
      isMissing: (incoming) => !incoming,
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'entityPreviewReplica',
      view: recordLens<EntityPreviewState, EntityPreview>('entityPreviewMap'),
    });
  }
}
