import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const DetailLoading = memo(() => {
  return (
    <>
      <Skeleton.Button active shape={'round'} size={'small'} width={64} />
      <Skeleton.Title active fontSize={20} lineHeight={1.4} />
      <Skeleton.Tags active count={2} />
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Skeleton.Tags active />
        <Skeleton.Tags active />
      </Flexbox>
      <Skeleton.Paragraph active fontSize={16} rows={6} />
    </>
  );
});

export default DetailLoading;
