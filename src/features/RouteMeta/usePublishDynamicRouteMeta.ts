import { useEffect } from 'react';

import type { DynamicRouteMeta } from '@/spa/router/routeMeta';

export const usePublishDynamicRouteMeta = (
  { avatar, avatarKind, avatarSeed, backgroundColor, title }: DynamicRouteMeta,
  onResolve: (meta: DynamicRouteMeta) => void,
) => {
  useEffect(() => {
    onResolve({ avatar, avatarKind, avatarSeed, backgroundColor, title });
  }, [avatar, avatarKind, avatarSeed, backgroundColor, onResolve, title]);
};
