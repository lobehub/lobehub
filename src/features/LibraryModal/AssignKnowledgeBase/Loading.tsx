import { Flexbox, Skeleton } from '@lobehub/ui';

const Loading = () => {
  return (
    <Flexbox>
      <Skeleton paragraph={{ rows: 8 }} title={false} />
    </Flexbox>
  );
};

export default Loading;
