import { type AddFavoriteParams, FAVORITE_LIMIT, type FavoriteType } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import { favoriteSelectors } from '@/store/home/selectors';

import { useFetchFavorites } from './useFetchFavorites';

/** Quiet period before a changed title or icon is written back to its favorite. */
export const FAVORITE_SNAPSHOT_SYNC_DELAY = 800;

/** Failed writes of one snapshot before the hook stops retrying it. */
export const FAVORITE_SNAPSHOT_SYNC_ATTEMPTS = 3;

export interface FavoriteTarget {
  /** Emoji or avatar URL of the target; omitted renders the type icon. */
  icon?: string | null;
  /** In-app link without the workspace slug; `useCurrentFavoritePath` gives the open page's. */
  path: string;
  /**
   * Whether `title` and `icon` are the target's own data. Pass `false` while
   * they are still placeholders (a topic whose detail has not loaded), so a
   * placeholder is never written over a saved favorite.
   */
  snapshotReady?: boolean;
  targetId: string;
  title: string;
  type: FavoriteType;
}

/**
 * Favorite state and toggle for one target. While the target is favorited
 * and mounted, a renamed title, new icon or moved link is written back to the
 * favorite so the sidebar row does not go stale.
 */
export const useFavoriteToggle = (target: FavoriteTarget | undefined) => {
  const { t } = useTranslation('common');
  useFetchFavorites();

  const type = target?.type;
  const targetId = target?.targetId;
  const favoriteId = useHomeStore((s) =>
    type && targetId ? favoriteSelectors.getFavorite(type, targetId)(s)?.id : undefined,
  );
  const isFavorite = !!favoriteId;
  const favoriteCount = useHomeStore((s) => favoriteSelectors.favoriteList(s)?.length);
  const snapshotReady = target?.snapshotReady ?? true;
  // Until the list loads, "not in the list" is unknown, not "not favorited": a
  // toggle then would add a row the member meant to remove. An add also waits
  // for the target's own title, so a placeholder is never saved; removing does not.
  const isReady = favoriteCount !== undefined && (isFavorite || snapshotReady);
  // The stored copy, so a write rolled back after a failure runs the sync again.
  const storedSnapshot = useHomeStore((s) => {
    const item = type && targetId ? favoriteSelectors.getFavorite(type, targetId)(s) : undefined;
    return item ? JSON.stringify([item.icon, item.path, item.title]) : undefined;
  });
  const failures = useRef({ count: 0, snapshot: '' });
  const [toggleFavorite, syncFavoriteSnapshot] = useHomeStore((s) => [
    s.toggleFavorite,
    s.syncFavoriteSnapshot,
  ]);

  const title = target?.title;
  const icon = target?.icon;
  const path = target?.path;
  // Titles change on every keystroke, so write once the target settles. The
  // favorite id is a dependency too: a rename made while the add was pending is
  // replayed once the confirmed row (and its real id) replaces the optimistic one.
  // A failed write rolls the stored copy back, which reruns this effect; a
  // snapshot that keeps failing stops after a few attempts instead of looping.
  useEffect(() => {
    if (!favoriteId || !snapshotReady || !type || !targetId || !title) return;
    const snapshot = JSON.stringify([icon ?? null, path, title]);
    if (failures.current.snapshot !== snapshot) failures.current = { count: 0, snapshot };
    if (failures.current.count >= FAVORITE_SNAPSHOT_SYNC_ATTEMPTS) return;

    const timer = setTimeout(() => {
      syncFavoriteSnapshot(type, targetId, { icon, path, title }).catch((error) => {
        if (failures.current.snapshot === snapshot) failures.current.count += 1;
        console.error('[favorite] failed to refresh the snapshot', error);
      });
    }, FAVORITE_SNAPSHOT_SYNC_DELAY);
    return () => clearTimeout(timer);
  }, [
    favoriteId,
    snapshotReady,
    storedSnapshot,
    type,
    targetId,
    title,
    icon,
    path,
    syncFavoriteSnapshot,
  ]);

  const toggle = useCallback(async () => {
    if (!target || !isReady) return;
    // A full sidebar rejects every add, so say how to make room instead of offering a retry.
    if (!isFavorite && (favoriteCount ?? 0) >= FAVORITE_LIMIT) {
      toast.error(t('favorite.limitReached', { count: FAVORITE_LIMIT }));
      return;
    }
    const params: AddFavoriteParams = {
      icon: target.icon ?? null,
      path: target.path,
      targetId: target.targetId,
      title: target.title,
      type: target.type,
    };
    try {
      await toggleFavorite(params);
    } catch (error) {
      console.error('[favorite] toggle failed', error);
      toast.error(t('favorite.updateError'));
    }
  }, [favoriteCount, isFavorite, isReady, t, target, toggleFavorite]);

  return { isFavorite, isReady, toggle };
};
