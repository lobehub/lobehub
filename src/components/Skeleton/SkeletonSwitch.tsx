import { Skeleton } from '@lobehub/ui/base-ui';
import { css, cx } from 'antd-style';

const switchLoading = cx(css`
  width: 44px !important;
  min-width: 44px !important;
  height: 22px !important;
  border-radius: 12px !important;
`);

export const SkeletonSwitch = () => {
  return <Skeleton className={switchLoading} height={36} />;
};
