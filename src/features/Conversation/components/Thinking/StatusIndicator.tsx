import { cssVar, Icon, Spin } from '@lobehub/ui';
import { AtomIcon } from 'lucide-react';
import { memo } from 'react';

import StepStatusBox from '../StepStatusBox';

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

  return <StepStatusBox>{icon}</StepStatusBox>;
});

export default StatusIndicator;
