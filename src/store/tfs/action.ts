import { createReplicaSlice, recordLens } from '@/libs/replica';
import { type TfsData, type TfsQuery, tfsService } from '@/services/tfs';

import { tfsQueryKey, tfsResource } from './projection';
import { initialTfsState, type TfsState, useTfsStore } from './store';

class TfsActions {
  readonly #data = createReplicaSlice(tfsResource, {
    actionPrefix: 'tfs/read',
    fetcher: tfsService.query,
    get: useTfsStore.getState,
    set: useTfsStore.setState,
    stateKey: 'replica',
    view: recordLens<TfsState, TfsData>('data'),
  });

  useFetch = (params: TfsQuery, enabled = true) =>
    this.#data.useSync(params, { enabled, dedupingInterval: 10_000 });
  refresh = (params: TfsQuery) => this.#data.fetch(params, { fresh: true });
  clear = async () => {
    await this.#data.clear();
  };
  reset = () => {
    useTfsStore.setState(initialTfsState());
  };
}
export const tfsActions = new TfsActions();
export const tfsSelectors = {
  data: (params: TfsQuery) => (state: TfsState) => state.data[tfsQueryKey(params)],
};
export const useTfsData = (params: TfsQuery, enabled = true) => {
  const flags = tfsActions.useFetch(params, enabled);
  const data = useTfsStore(tfsSelectors.data(params));
  return { ...flags, data };
};
