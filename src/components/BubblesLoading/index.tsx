import { Center } from '@lobehub/ui';
import { LoadingDots } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const BubblesLoading = memo(() => {
  return (
    <Center style={{ height: 24, width: 32 }}>
      <LoadingDots color={cssVar.colorTextSecondary} size={12} variant={'pulse'} />
    </Center>
  );
});

export default BubblesLoading;
