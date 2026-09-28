import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';

const Loading = () => {
  return (
    <Flexbox padding={16}>
      <Skeleton.Text rows={8} />
    </Flexbox>
  );
};

export default Loading;
