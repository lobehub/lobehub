import { FolderClosedIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

export const projectsRouteMeta = routeMeta({
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.projects',
});
