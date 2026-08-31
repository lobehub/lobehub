import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const SkeletonLoading = memo(() => (
  <Flexbox padding={12}>
    <Skeleton.Text  width={'70%'} />
    <Skeleton.Text  width={'40%'} />
    <Skeleton.Text  width={'80%'} />
    <Skeleton.Text  width={'30%'} />
    <Skeleton.Text  width={'50%'} />
    <Skeleton.Text  width={'70%'} />
  </Flexbox>
));

export default SkeletonLoading;
