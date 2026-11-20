import { LayersEnum } from '@lobechat/types';

/**
 * Memory layers that have a detail surface (memory page right panel + chat Portal view). The
 * experience layer has no surface any more, so it is intentionally absent.
 */
export const MEMORY_DETAIL_ROUTE_BY_LAYER: Partial<
  Record<LayersEnum, { idParam: string; path: string }>
> = {
  [LayersEnum.Activity]: { idParam: 'activityId', path: '/memory/activities' },
  [LayersEnum.Context]: { idParam: 'contextId', path: '/memory/contexts' },
  [LayersEnum.Identity]: { idParam: 'identityId', path: '/memory/identities' },
  [LayersEnum.Preference]: { idParam: 'preferenceId', path: '/memory/preferences' },
};

export const hasMemoryDetailView = (layer?: LayersEnum): layer is LayersEnum =>
  Boolean(layer && MEMORY_DETAIL_ROUTE_BY_LAYER[layer]);

/** Full-page memory route for one layer, optionally focused on a layer-specific row id. */
export const getMemoryDetailPath = (layer: LayersEnum, id?: string) => {
  const route = MEMORY_DETAIL_ROUTE_BY_LAYER[layer];
  if (!route) return '/memory';

  return id ? `${route.path}?${route.idParam}=${encodeURIComponent(id)}` : route.path;
};
