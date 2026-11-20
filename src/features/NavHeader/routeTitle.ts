import { getRouteMetaFromHandle } from '@/spa/router/routeMeta';

/** The deepest route title in a match chain (`useMatches()` handles). */
export const findRouteTitleKey = (handles: readonly unknown[]): string | undefined => {
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    const titleKey = getRouteMetaFromHandle(handles[i])?.titleKey;
    if (titleKey) return titleKey;
  }
  return undefined;
};

/**
 * Namespaces a route title needs loaded. Titles default to `electron`; a
 * `project:sections.home` style key names its own namespace, which a mobile
 * page may not have loaded yet.
 */
export const getRouteTitleNamespaces = (titleKey: string | undefined): string[] => {
  const separator = titleKey?.indexOf(':') ?? -1;
  return separator > 0 ? ['electron', titleKey!.slice(0, separator)] : ['electron'];
};
