import { useCallback, useEffect, useState } from 'react';

/**
 * Persist a small piece of UI state in `window.localStorage`.
 *
 * - SSR-safe: defers the read until after mount so the server and first client
 *   render agree, then hydrates from storage in an effect.
 * - Cross-instance sync: subscribes to `storage` events so multiple panes /
 *   windows that mount the same key stay aligned.
 */
export const useLocalStorageState = <T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] => {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore parse / access failures (private mode, quota, malformed JSON)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return;
      try {
        setValue(JSON.parse(event.newValue) as T);
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // ignore write failures
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
};
