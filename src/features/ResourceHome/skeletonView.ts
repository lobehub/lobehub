import { getDefaultResourceViewMode } from '@/features/ResourceManager/components/Explorer/viewMode';
import type { FilesTabs } from '@/types/files';

export type ResourceSkeletonView = 'list' | 'masonry' | 'works';

export const resolveResourceSkeletonView = (
  pathname: string,
  requestedView: string | null,
): ResourceSkeletonView => {
  const segment = pathname.split('/').findLast(Boolean);

  if (segment === 'works') return 'works';
  if (requestedView === 'list' || requestedView === 'masonry') return requestedView;

  return getDefaultResourceViewMode(segment as FilesTabs);
};
