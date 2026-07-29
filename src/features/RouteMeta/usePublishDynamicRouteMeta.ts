import { useEffect } from 'react';

import type { DynamicRouteMeta } from '@/spa/router/routeMeta';

export const usePublishDynamicRouteMeta = (
  { avatar, backgroundColor, title }: DynamicRouteMeta,
  onResolve: (meta: DynamicRouteMeta) => void,
) => {
  useEffect(() => {
    onResolve({ avatar, backgroundColor, title });
  }, [avatar, backgroundColor, onResolve, title]);
};
