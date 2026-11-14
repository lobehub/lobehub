import { useCallback, useEffect, useRef, useState } from 'react';

import {
  localDatabase,
  type LocalDatabaseCollectionInfo,
  type LocalDatabaseEntry,
  type LocalDatabaseKeyGroup,
  type LocalDatabaseKeyPage,
} from '@/libs/localDatabase';

import {
  MAX_RENDERED_ROWS,
  REPLICA_KEY_DELIMITER,
  REPLICA_KEY_PREFIX,
  replicaResourcePrefix,
} from './model';

interface InspectorQuery {
  collection: string | null;
  resource: string | null;
  search: string;
}

interface LocalDatabaseInspectorState {
  collections: LocalDatabaseCollectionInfo[];
  error: string | null;
  isLoading: boolean;
  isRecordLoading: boolean;
  keys: string[];
  matchingCount: number;
  resources: LocalDatabaseKeyGroup[];
  search: string;
  selectedCollection: string | null;
  selectedEntry: LocalDatabaseEntry | null;
  selectedKey: string | null;
  selectedResource: string | null;
}

const INITIAL_QUERY: InspectorQuery = { collection: null, resource: null, search: '' };
const EMPTY_PAGE: LocalDatabaseKeyPage = { keys: [], total: 0 };

const INITIAL_STATE: LocalDatabaseInspectorState = {
  collections: [],
  error: null,
  isLoading: true,
  isRecordLoading: false,
  keys: [],
  matchingCount: 0,
  resources: [],
  search: '',
  selectedCollection: null,
  selectedEntry: null,
  selectedKey: null,
  selectedResource: null,
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useLocalDatabaseInspector = () => {
  const [state, setState] = useState<LocalDatabaseInspectorState>(INITIAL_STATE);
  const queryRef = useRef(INITIAL_QUERY);
  const selectedKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const recordRequestIdRef = useRef(0);

  const loadKeys = useCallback(async (query: InspectorQuery, reloadCollections: boolean) => {
    const requestId = ++requestIdRef.current;
    const previous = queryRef.current;
    const sameTable =
      previous.collection === query.collection && previous.resource === query.resource;
    queryRef.current = query;

    if (!sameTable) {
      recordRequestIdRef.current += 1;
      selectedKeyRef.current = null;
    }

    setState((current) => ({
      ...current,
      error: null,
      isLoading: true,
      search: query.search,
      selectedCollection: query.collection,
      selectedResource: query.resource,
      ...(!sameTable && {
        isRecordLoading: false,
        keys: [],
        selectedEntry: null,
        selectedKey: null,
      }),
    }));

    try {
      let { collection, resource } = query;
      let collections: LocalDatabaseCollectionInfo[] | undefined;

      if (reloadCollections) {
        collections = await localDatabase.listCollections();
        collection =
          collections.find(({ name }) => name === collection)?.name ??
          collections.at(0)?.name ??
          null;
      }

      let resources: LocalDatabaseKeyGroup[] = [];
      let page = EMPTY_PAGE;

      if (collection) {
        resources = await localDatabase.keyGroupsByPrefix(
          collection,
          REPLICA_KEY_PREFIX,
          REPLICA_KEY_DELIMITER,
        );
        if (!resources.some(({ name }) => name === resource)) resource = null;

        page = await localDatabase.keysByPrefix(
          collection,
          resource ? replicaResourcePrefix(resource) : '',
          { limit: MAX_RENDERED_ROWS, search: query.search },
        );
      }

      if (requestId !== requestIdRef.current) return;
      queryRef.current = { collection, resource, search: query.search };
      setState((current) => ({
        ...current,
        collections: collections ?? current.collections,
        isLoading: false,
        keys: page.keys,
        matchingCount: page.total,
        resources,
        selectedCollection: collection,
        selectedResource: resource,
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({ ...current, error: errorMessage(error), isLoading: false }));
    }
  }, []);

  const selectKey = useCallback(async (key: string) => {
    const { collection } = queryRef.current;
    if (!collection) return;

    const requestId = ++recordRequestIdRef.current;
    selectedKeyRef.current = key;
    setState((current) => ({
      ...current,
      isRecordLoading: true,
      selectedEntry: current.selectedKey === key ? current.selectedEntry : null,
      selectedKey: key,
    }));

    try {
      const value = await localDatabase.get(collection, key);
      if (requestId !== recordRequestIdRef.current) return;
      setState((current) => ({
        ...current,
        isRecordLoading: false,
        selectedEntry: value === undefined ? null : { key, value },
      }));
    } catch (error) {
      if (requestId !== recordRequestIdRef.current) return;
      setState((current) => ({
        ...current,
        error: errorMessage(error),
        isRecordLoading: false,
      }));
    }
  }, []);

  useEffect(() => {
    void loadKeys(INITIAL_QUERY, true);
    return () => {
      requestIdRef.current += 1;
      recordRequestIdRef.current += 1;
    };
  }, [loadKeys]);

  const selectCollection = useCallback(
    (collection: string) => loadKeys({ collection, resource: null, search: '' }, false),
    [loadKeys],
  );

  const selectResource = useCallback(
    (resource: string | null) =>
      loadKeys({ collection: queryRef.current.collection, resource, search: '' }, false),
    [loadKeys],
  );

  const setSearch = useCallback(
    (search: string) => loadKeys({ ...queryRef.current, search }, false),
    [loadKeys],
  );

  const refresh = useCallback(async () => {
    const selectedKey = selectedKeyRef.current;
    await Promise.all([
      loadKeys(queryRef.current, true),
      selectedKey === null ? undefined : selectKey(selectedKey),
    ]);
  }, [loadKeys, selectKey]);

  return { ...state, refresh, selectCollection, selectKey, selectResource, setSearch };
};
