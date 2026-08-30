import type { BriefItem } from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, projectionObservation } from '../../core/ingest';
import type { ProjectionStore } from '../../store';
import { ingestBriefNews } from './ingestors';

type Setter = StoreSetter<ProjectionStore>;

export interface BriefProjectionAction {
  commitBriefNews: (
    scope: string,
    day: string,
    hasEarlier: boolean,
    items: BriefItem[],
    observedAt?: number,
  ) => void;
}

class BriefProjectionActionImpl implements BriefProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitBriefNews = (
    scope: string,
    day: string,
    hasEarlier: boolean,
    items: BriefItem[],
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestBriefNews(day, hasEarlier, items, projectionObservation('network', observedAt)),
    );
  };
}

export const createBriefProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new BriefProjectionActionImpl(set, get, api);
