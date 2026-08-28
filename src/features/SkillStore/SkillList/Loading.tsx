import { Flexbox, Skeleton } from '@lobehub/ui';

const Loading = () => {
  return (
    <Flexbox padding={16}>
      <Skeleton active paragraph={{ rows: 8 }} title={false} />
    </Flexbox>
  );
};

export default Loading;
