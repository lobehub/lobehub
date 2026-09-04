import {
  type DataRouter,
  type Location,
  type Params,
  type RouterState,
  type UIMatch,
} from 'react-router';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface RouterStoreState {
  location: Location;
  matches: UIMatch[];
  params: Readonly<Params>;
  routerState: RouterState | null;
}

interface ManagedRouterStore {
  api: StoreApi<RouterStoreState>;
  router?: DataRouter;
  unsubscribe?: () => void;
}

const storesByRouter = new WeakMap<DataRouter, ManagedRouterStore>();
const storesByScope = new Map<string, ManagedRouterStore>();

const paramsEqual = (left: Readonly<Params>, right: Readonly<Params>) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

const toUIMatches = (state: RouterState): UIMatch[] =>
  state.matches.map((match) => ({
    handle: match.route.handle,
    id: match.route.id,
    loaderData: state.loaderData[match.route.id],
    params: match.params,
    pathname: match.pathname,
  }));

const fromRouterState = (state: RouterState, previous?: RouterStoreState): RouterStoreState => {
  const nextParams = state.matches.at(-1)?.params ?? {};

  return {
    location: state.location,
    matches: toUIMatches(state),
    params: previous && paramsEqual(previous.params, nextParams) ? previous.params : nextParams,
    routerState: state,
  };
};

const createManagedStore = (state: RouterStoreState): ManagedRouterStore => ({
  api: createStore<RouterStoreState>(() => state),
});

const bindRouter = (managed: ManagedRouterStore, router: DataRouter) => {
  if (managed.router === router) return;

  managed.unsubscribe?.();
  managed.router = router;
  managed.api.setState(fromRouterState(router.state, managed.api.getState()), true);
  managed.unsubscribe = router.subscribe((state) => {
    managed.api.setState(fromRouterState(state, managed.api.getState()), true);
  });
  storesByRouter.set(router, managed);
};

export const getRouterStore = (
  router: DataRouter,
  scopeId?: string,
): StoreApi<RouterStoreState> => {
  if (scopeId) {
    const managed = storesByScope.get(scopeId) ?? createManagedStore(fromRouterState(router.state));
    storesByScope.set(scopeId, managed);
    bindRouter(managed, router);
    return managed.api;
  }

  const existing = storesByRouter.get(router);
  if (existing) return existing.api;

  const managed = createManagedStore(fromRouterState(router.state));
  bindRouter(managed, router);
  return managed.api;
};

export const disposeScopedRouterStore = (scopeId: string) => {
  const managed = storesByScope.get(scopeId);
  managed?.unsubscribe?.();
  storesByScope.delete(scopeId);
};
