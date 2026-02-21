import { type KlavisServerType } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

export const SKILL_ICON_SIZE = 20;

/**
 * Klavis 服务器图标组件
 */
const KlavisSkillIcon = memo<Pick<KlavisServerType, 'icon' | 'label'> & { size: number }>(
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

KlavisSkillIcon.displayName = 'KlavisSkillIcon';

export default KlavisSkillIcon;
