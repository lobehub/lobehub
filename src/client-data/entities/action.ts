import type {
  BriefItem,
  ChatTopicStatus,
  EntityFragment,
  EntitySource,
  TaskEntityRecord,
  TaskStatus,
  TopicEntityRecord,
} from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import type { ClientDataStore } from '../store';
import { findTaskEntityRecord } from './selectors';

type Setter = StoreSetter<ClientDataStore>;

interface EntityObservation {
  observedAt: number;
  source: EntitySource;
}

const observation = (
  source: EntitySource = 'mutation',
  observedAt: number = Date.now(),
): EntityObservation => ({ observedAt, source });

const fragment = <T>(data: T, meta: EntityObservation): EntityFragment<T> => ({ data, ...meta });

export interface ClientDataEntityAction {
  updateBriefReadState: (
    scope: string,
    id: string,
    readAt: Date | string | null,
    observedAt?: number,
  ) => void;
  updateTaskEntityStatus: (
    scope: string,
    identity: string,
    status: TaskStatus,
    source?: EntitySource,
    observedAt?: number,
  ) => void;
  updateTopicEntityStatus: (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source?: EntitySource,
    observedAt?: number,
  ) => void;
  updateTopicEntityTitle: (scope: string, id: string, title: string, observedAt?: number) => void;
}

class ClientDataEntityActionImpl implements ClientDataEntityAction {
  readonly #get: () => ClientDataStore;

  constructor(_set: Setter, get: () => ClientDataStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  updateTopicEntityStatus = (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source: EntitySource = 'mutation',
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation(source, observedAt);
    const record: TopicEntityRecord = {
      fragments: { status: fragment({ status }, meta) },
      id,
      kind: 'topic',
    };
    this.#get().internal_commitClientData(scope, { entities: [record] });
  };

  updateTopicEntityTitle = (
    scope: string,
    id: string,
    title: string,
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const record: TopicEntityRecord = {
      fragments: { display: fragment({ title }, meta) },
      id,
      kind: 'topic',
    };
    this.#get().internal_commitClientData(scope, { entities: [record] });
  };

  updateTaskEntityStatus = (
    scope: string,
    identity: string,
    status: TaskStatus,
    source: EntitySource = 'mutation',
    observedAt: number = Date.now(),
  ): void => {
    const current = findTaskEntityRecord(this.#get().scopes[scope], identity);
    if (!current) return;
    const meta = observation(source, observedAt);
    const record: TaskEntityRecord = {
      fragments: { lifecycle: fragment({ status }, meta) },
      id: current.id,
      kind: 'task',
    };
    this.#get().internal_commitClientData(scope, { entities: [record] });
  };

  updateBriefReadState = (
    scope: string,
    id: string,
    readAt: BriefItem['readAt'],
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    this.#get().internal_commitClientData(scope, {
      entities: [
        {
          fragments: { readState: fragment({ readAt }, meta) },
          id,
          kind: 'brief',
        },
      ],
    });
  };
}

export const createClientDataEntityAction = (
  set: Setter,
  get: () => ClientDataStore,
  api?: unknown,
) => new ClientDataEntityActionImpl(set, get, api);
