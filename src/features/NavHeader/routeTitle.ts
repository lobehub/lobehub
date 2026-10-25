import { getRouteMetaFromHandle } from '@/spa/router/routeMeta';

/** The deepest static `titleKey` along the matched route chain. */
export const findRouteTitleKey = (handles: readonly unknown[]): string | undefined => {
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    const titleKey = getRouteMetaFromHandle(handles[i])?.titleKey;
    if (titleKey) return titleKey;
  }
  return undefined;
};
