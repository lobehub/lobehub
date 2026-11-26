import { type ResolvedRouteMeta } from '@/spa/router/routeMeta';

/**
 * Which leading visual a page entry draws. Tabs and the recently-viewed menu both read
 * this, so the same page shows the same avatar in both places instead of the menu
 * falling back to the route icon.
 */
export type TabVisual = 'agent' | 'avatar' | 'icon' | 'none' | 'project' | 'workspace';

export const resolveTabVisual = (meta: ResolvedRouteMeta): TabVisual => {
  if (meta.avatarKind === 'agent') return 'agent';
  // A seed only exists for entities that generate their own fallback (projects).
  if (meta.avatarSeed) return 'project';
  if (meta.avatarKind === 'workspace') return 'workspace';
  if (meta.avatar) return 'avatar';
  return meta.icon ? 'icon' : 'none';
};
