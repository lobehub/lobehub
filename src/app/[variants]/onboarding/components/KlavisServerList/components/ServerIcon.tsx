import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { memo } from 'react';

interface ServerIconProps {
  icon: string | LucideIcon;
  label: string;
}

const ServerIcon = memo<ServerIconProps>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <Avatar alt={label} avatar={icon} shape={'square'} size={24} style={{ flex: 'none' }} />;
  }

  return <Icon fill={cssVar.colorText} icon={icon} size={24} />;
});

ServerIcon.displayName = 'ServerIcon';

export default ServerIcon;
