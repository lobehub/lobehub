'use client';

import { useEffect, useRef } from 'react';

import { parseAsString, useQueryState } from '@/hooks/useQueryParam';

interface UseBidirectionalQuerySyncOptions {
  /**
   * Default value when query is not present
   */
  defaultValue: string;
}

/**
 * Hook for bidirectional sync between URL query parameter and store state.
 * Prevents infinite loops by tracking the source of changes.
 *
 * @param queryKey - The URL query parameter key
 * @param storeValue - Current value from the store
 * @param setStoreValue - Function to update store value (setState or action)
 * @param options - Configuration with required defaultValue
 *
 * @example
 * ```tsx
 * // In a component
 * const activeTabId = useGroupProfileStore((s) => s.activeTabId);
 *
 * useBidirectionalQuerySync('tab', activeTabId, (value) => {
 *   useGroupProfileStore.setState({ activeTabId: value });
 * }, { defaultValue: 'group' });
 * ```
 */
export const useBidirectionalQuerySync = (
  queryKey: string,
  storeValue: string,
  setStoreValue: (value: string) => void,
  options: UseBidirectionalQuerySyncOptions,
) => {
  const { defaultValue } = options;

  const [queryValue, setQueryValue] = useQueryState(
    queryKey,
    parseAsString.withDefault(defaultValue),
  );

  // Track if the change came from URL to prevent sync loops
  const isUrlChangeRef = useRef(false);

  // Sync URL → Store (when URL changes)
  useEffect(() => {
    if (queryValue !== storeValue) {
      isUrlChangeRef.current = true;
      setStoreValue(queryValue);
    }
  }, [queryValue, setStoreValue]);

  // Sync Store → URL (when store changes, but not from URL)
  useEffect(() => {
    if (isUrlChangeRef.current) {
      isUrlChangeRef.current = false;
      return;
    }
    if (storeValue !== queryValue) {
      setQueryValue(storeValue);
    }
  }, [storeValue, queryValue, setQueryValue]);
};

/**
 * Hook for bidirectional sync with optional/undefined store values.
 * Useful when the store value can be undefined (like activeTopicId).
 *
 * @example
 * ```tsx
 * const activeTopicId = useChatStore((s) => s.activeTopicId);
 *
 * useBidirectionalQuerySyncOptional('bt', activeTopicId, (value) => {
 *   useChatStore.setState({ activeTopicId: value });
 * });
 * ```
 */
export const useBidirectionalQuerySyncOptional = (
  queryKey: string,
  storeValue: string | undefined,
  setStoreValue: (value: string | undefined) => void,
) => {
  const [queryValue, setQueryValue] = useQueryState(queryKey);

  // Track if the change came from URL to prevent sync loops
  const isUrlChangeRef = useRef(false);

  // Sync URL → Store (when URL changes)
  useEffect(() => {
    const urlValue = queryValue ?? undefined;
    if (urlValue !== storeValue) {
      isUrlChangeRef.current = true;
      setStoreValue(urlValue);
    }
  }, [queryValue, setStoreValue]);

  // Sync Store → URL (when store changes, but not from URL)
  useEffect(() => {
    if (isUrlChangeRef.current) {
      isUrlChangeRef.current = false;
      return;
    }
    const urlValue = queryValue ?? undefined;
    if (storeValue !== urlValue) {
      setQueryValue(storeValue ?? null);
    }
  }, [storeValue, queryValue, setQueryValue]);
};
