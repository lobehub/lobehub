import { Flexbox, Skeleton } from '@lobehub/ui';

const Loading = () => {
  return (
    <Flexbox padding={16}>
      <Skeleton.Text  rows={8} />
    </Flexbox>
  );
};

export default Loading;
