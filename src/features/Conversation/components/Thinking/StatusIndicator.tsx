import { Block, cssVar, Icon, Spin } from '@lobehub/ui';
import { AtomIcon } from 'lucide-react';
import { memo } from 'react';

interface StatusIndicatorProps {
  showDetail?: boolean;
  thinking?: boolean;
}

const StatusIndicator = memo<StatusIndicatorProps>(({ thinking, showDetail }) => {
  let icon;

  if (thinking) {
    icon = <Spin size="small" style={{ color: cssVar.colorTextDescription }} />;
  } else {
    icon = (
      <Icon color={showDetail ? cssVar.purple : cssVar.colorTextDescription} icon={AtomIcon} />
    );
  }

  return (
    <Block
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={24}
      justify={'center'}
      variant={'outlined'}
      width={24}
      style={{
        fontSize: 12,
      }}
    >
      {icon}
    </Block>
  );
});

export default StatusIndicator;
