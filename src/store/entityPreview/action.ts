import { type ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type EntityPreviewState, initialState } from './initialState';
import { EntityPreviewPrivateAction } from './privateAction';
import { type EntityPreviewParams } from './projection';
import { useEntityPreviewStore } from './store';

const n = setNamespace('entityPreview');

type Setter = StoreSetter<EntityPreviewState>;

/**
 * A conversation can link the same entity many times, and each link plus its
 * hover card mounts a sync: collapse them into one request per entity.
 */
const ENTITY_PREVIEW_DEDUPING_INTERVAL = 10_000;

export class EntityPreviewActionImpl {
  readonly #private: EntityPreviewPrivateAction;
  readonly #set: Setter;

  constructor(
    set: Setter,
    _get: () => EntityPreviewState,
    privateAction: EntityPreviewPrivateAction,
  ) {
    this.#set = set;
    this.#private = privateAction;
  }

  /**
   * Fetch orchestration for one linked entity's preview. Read it with
   * `entityPreviewSelectors.getPreview`, not from the return value.
   */
  useFetchEntityPreview = (
    params: EntityPreviewParams | null,
    { enabled = true }: { enabled?: boolean } = {},
  ): ReplicaSyncResult =>
    this.#private.previews.useSync(params, {
      dedupingInterval: ENTITY_PREVIEW_DEDUPING_INTERVAL,
      enabled,
      revalidateOnFocus: false,
    });

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useEntityPreviewStore;

export const entityPreviewActions = new EntityPreviewActionImpl(
  setState,
  getState,
  new EntityPreviewPrivateAction(setState, getState),
);
