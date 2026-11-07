import { type RouteMetaParams } from '@/spa/router/routeMeta';

export const mergeSearchParams = (params: RouteMetaParams, url: string): RouteMetaParams => {
  const [, rawSearch = ''] = url.split('?');
  const search = rawSearch.split('#')[0] ?? '';
  if (!search) return params;

  const next: RouteMetaParams = { ...params };
  const searchParams = new URLSearchParams(search);

  for (const [key, value] of searchParams.entries()) {
    next[key] ??= value;
  }

  return next;
};
