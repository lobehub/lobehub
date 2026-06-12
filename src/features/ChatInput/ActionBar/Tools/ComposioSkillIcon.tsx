import { type ComposioAppType } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

export const SKILL_ICON_SIZE = 20;

/**
 * Composio server icon component
 */
const ComposioSkillIcon = memo<Pick<ComposioAppType, 'icon' | 'label'> & { size: number }>(
  ({ icon, label, size = SKILL_ICON_SIZE }) => {
    if (typeof icon === 'string') {
      return (
        <img
          alt={label}
          src={icon}
          style={{ maxHeight: size, maxWidth: size, objectFit: 'contain' }}
        />
      );
    }

    return <Icon fill={cssVar.colorText} icon={icon} size={size} />;
  },
);

ComposioSkillIcon.displayName = 'ComposioSkillIcon';

export default ComposioSkillIcon;
