import isEqual from 'fast-deep-equal';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { fetchEntityPreview } from './fetchEntityPreview';
import { type EntityPreviewState } from './initialState';
import { type EntityPreview, entityPreviewResource } from './projection';

type Setter = StoreSetter<EntityPreviewState>;

const n = setNamespace('entityPreview');

export class EntityPreviewPrivateAction {
  readonly previews;

  constructor(set: Setter, get: () => EntityPreviewState) {
    this.previews = createReplicaSlice(entityPreviewResource, {
      actionPrefix: 'entityPreview',
      effects: {
        onApplied: (_data, _params, { key }) => {
          if (!(key in get().entityPreviewMissing)) return;
          const { [key]: _, ...rest } = get().entityPreviewMissing;
          set({ entityPreviewMissing: rest }, false, n('entityPreviewFound'));
        },
        onMissing: (_params, { key, scope }) => {
          set(
            { entityPreviewMissing: { ...get().entityPreviewMissing, [key]: scope } },
            false,
            n('entityPreviewMissing'),
          );
        },
      },
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
