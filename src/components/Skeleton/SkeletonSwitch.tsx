import { Skeleton } from '@lobehub/ui';

// Inline size: Skeleton sets its own height/width inline, which only an inline value can override.
export const SkeletonSwitch = () => {
  return <Skeleton height={22} radius={12} style={{ minWidth: 44 }} width={44} />;
};
