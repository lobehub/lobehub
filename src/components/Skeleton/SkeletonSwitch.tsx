import { css, cx, Skeleton } from '@lobehub/ui';

const switchLoading = cx(css`
  width: 44px !important;
  min-width: 44px !important;
  height: 22px !important;
  border-radius: 12px !important;
`);

export const SkeletonSwitch = () => {
  return <Skeleton className={switchLoading} height={36} />;
};
