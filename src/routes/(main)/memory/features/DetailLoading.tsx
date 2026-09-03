import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

const DetailLoading = memo(() => {
  return (
    <>
      <Skeleton height={28} radius={999} width={64} />
      <Skeleton.Text fontSize={20} lineHeight={1.4} />
      <Flexbox horizontal gap={8}>
        <Skeleton height={22} radius={4} width={48} />
        <Skeleton height={22} radius={4} width={48} />
      </Flexbox>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Skeleton height={22} radius={4} width={48} />
        <Skeleton height={22} radius={4} width={48} />
      </Flexbox>
      <Skeleton.Text fontSize={16} rows={6} />
    </>
  );
});

export default DetailLoading;
