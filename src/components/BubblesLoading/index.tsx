import { Center, cssVar } from '@lobehub/ui';
import { LoadingDots } from '@lobehub/ui/chat';

const BubblesLoading = () => {
  return (
    <Center style={{ height: 24, width: 32 }}>
      <LoadingDots color={cssVar.colorTextSecondary} size={12} variant={'pulse'} />
    </Center>
  );
};

export default BubblesLoading;
