import { SkeletonLoading } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';

const Loading = () => (
  <Flexbox gap={16} style={{ padding: 16 }}>
    <SkeletonLoading paragraph={{ rows: 8 }} />
  </Flexbox>
);

export default Loading;
