import { useCallback, useEffect, useRef, useState } from 'react';

import {
  localDatabase,
  type LocalDatabaseCollectionInfo,
  type LocalDatabaseEntry,
} from '@/libs/localDatabase';

interface LocalDatabaseInspectorState {
  collections: LocalDatabaseCollectionInfo[];
  entries: LocalDatabaseEntry[];
  error: string | null;
  isLoading: boolean;
  selectedCollection: string | null;
}

const INITIAL_STATE: LocalDatabaseInspectorState = {
  collections: [],
  entries: [],
  error: null,
  isLoading: true,
  selectedCollection: null,
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useLocalDatabaseInspector = () => {
  const [state, setState] = useState<LocalDatabaseInspectorState>(INITIAL_STATE);
  const requestIdRef = useRef(0);

  const loadSnapshot = useCallback(async (preferredCollection: string | null) => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, error: null, isLoading: true }));

    try {
      const collections = await localDatabase.listCollections();
      const selectedCollection =
        collections.find(({ name }) => name === preferredCollection)?.name ??
        collections.at(0)?.name ??
        null;
      const entries = selectedCollection
        ? await localDatabase.entriesByPrefix(selectedCollection, '')
        : [];

      if (requestId !== requestIdRef.current) return;
      setState({ collections, entries, error: null, isLoading: false, selectedCollection });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({ ...current, error: errorMessage(error), isLoading: false }));
    }
  }, []);

  const selectCollection = useCallback(async (selectedCollection: string) => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({
      ...current,
      entries: [],
      error: null,
      isLoading: true,
      selectedCollection,
    }));

    try {
      const entries = await localDatabase.entriesByPrefix(selectedCollection, '');
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({ ...current, entries, isLoading: false }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({ ...current, error: errorMessage(error), isLoading: false }));
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(null);
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadSnapshot]);

  const refresh = useCallback(
    () => loadSnapshot(state.selectedCollection),
    [loadSnapshot, state.selectedCollection],
  );

  return { ...state, refresh, selectCollection };
};
