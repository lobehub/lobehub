import { Center, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';

const VirtuosoLoading = memo(() => {
  return (
    <Center padding={16}>
      <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} />
    </Center>
  );
});

export default VirtuosoLoading;
