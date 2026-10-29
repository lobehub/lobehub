import { useEffect, useId, useSyncExternalStore } from 'react';

/**
 * A page can show two favorite stars at once (a chat header and a task opened
 * in its side panel). The favorite hotkey belongs to the star mounted last —
 * the surface the member opened most recently — so one press never toggles
 * two favorites.
 */
let owners: string[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getOwner = () => owners.at(-1);

export const useOwnsFavoriteHotkey = (): boolean => {
  const id = useId();

  useEffect(() => {
    owners = [...owners, id];
    emit();
    return () => {
      owners = owners.filter((owner) => owner !== id);
      emit();
    };
  }, [id]);

  return useSyncExternalStore(subscribe, getOwner, getOwner) === id;
};
