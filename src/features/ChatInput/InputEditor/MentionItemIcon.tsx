import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { memo } from 'react';

import SkillAvatar from '@/components/SkillAvatar';

interface MentionItemIconProps {
  avatar?: string;
  category: 'skill' | 'tool';
  label: string;
  size?: number;
}

const isAvatarPlaceholder = (avatar?: string) => Boolean(avatar && avatar.endsWith('_AVATAR'));

const MentionItemIcon = memo<MentionItemIconProps>(({ avatar, category, label, size = 24 }) => {
  const normalizedAvatar = isAvatarPlaceholder(avatar) ? undefined : avatar;

  if (category === 'tool' && !normalizedAvatar) {
    return <Icon icon={McpIcon} size={Math.round(size * 0.8)} />;
  }

  if (category === 'skill' && !normalizedAvatar) {
    return <SkillAvatar size={size} />;
  }

  return (
    <Avatar
      avatar={normalizedAvatar}
      shape={'square'}
      size={size}
      style={{ flex: 'none', overflow: 'hidden' }}
      title={label}
    />
  );
});

MentionItemIcon.displayName = 'MentionItemIcon';

export default MentionItemIcon;
