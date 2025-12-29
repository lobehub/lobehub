import { Block, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { AtomIcon, Loader2Icon } from 'lucide-react';
import { memo } from 'react';

interface StatusIndicatorProps {
  showDetail?: boolean;
  thinking?: boolean;
}

const StatusIndicator = memo<StatusIndicatorProps>(({ thinking, showDetail }) => {
  let icon;

  if (thinking) {
    icon = <Icon color={cssVar.colorTextDescription} icon={Loader2Icon} spin />;
  } else {
    icon = (
      <Icon color={showDetail ? cssVar.purple : cssVar.colorTextDescription} icon={AtomIcon} />
    );
  }

  return (
    <Block
      align={'center'}
      flex={'none'}
      gap={4}
      height={24}
      horizontal
      justify={'center'}
      style={{
        fontSize: 12,
      }}
      variant={'outlined'}
      width={24}
    >
      {icon}
    </Block>
  );
});

export default StatusIndicator;
