// Fixture: a size variant only changes styling.
import { Avatar } from '@lobehub/ui/base-ui';
import { memo } from 'react';

interface Props {
  avatar: string;
  size?: 'small' | 'large';
}

const AgentAvatar = memo<Props>(({ avatar, size = 'small' }) => (
  <Avatar avatar={avatar} size={size === 'large' ? 64 : 28} />
));

export default AgentAvatar;
