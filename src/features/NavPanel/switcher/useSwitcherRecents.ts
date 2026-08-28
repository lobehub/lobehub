import { useCallback, useEffect, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { touchRecentId } from './switcherItems';

const STORAGE_PREFIX = 'lobe-switcher-recent';

const readIds = (key: string): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
};

const writeIds = (key: string, ids: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(ids));
};

export const useSwitcherRecents = (kind: 'agent' | 'project') => {
  const workspaceId = useActiveWorkspaceId();
  const key = `${STORAGE_PREFIX}:${workspaceId ?? 'personal'}:${kind}`;
  const [ids, setIds] = useState<string[]>(() => readIds(key));

  useEffect(() => {
    setIds(readIds(key));
  }, [key]);

  const touch = useCallback(
    (id: string) => {
      if (!id) return;
      setIds((prev) => {
        const next = touchRecentId(prev, id);
        writeIds(key, next);
        return next;
      });
    },
    [key],
  );

  return { ids, touch };
};
