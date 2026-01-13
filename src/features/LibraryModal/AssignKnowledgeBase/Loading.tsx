import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const Loading = memo(() => {
  return (
    <Flexbox>
      <Skeleton paragraph={{ rows: 8 }} title={false} />
    </Flexbox>
  );
});

export default Loading;
