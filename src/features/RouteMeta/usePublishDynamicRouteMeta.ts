import { useEffect } from 'react';

import type { DynamicRouteMeta } from '@/spa/router/routeMeta';

export const usePublishDynamicRouteMeta = (
  { avatar, avatarSeed, backgroundColor, title }: DynamicRouteMeta,
  onResolve: (meta: DynamicRouteMeta) => void,
) => {
  useEffect(() => {
    onResolve({ avatar, avatarSeed, backgroundColor, title });
  }, [avatar, avatarSeed, backgroundColor, onResolve, title]);
};
