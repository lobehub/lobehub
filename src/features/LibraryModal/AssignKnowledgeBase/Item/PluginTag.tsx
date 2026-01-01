import { Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { BadgeCheck, CircleUser, Package } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type InstallPluginMeta } from '@/types/tool/plugin';

const styles = createStaticStyles(({ css, cssVar }) => ({
  community: css`
    color: color-mix(in srgb, ${cssVar.colorInfo} 75%, transparent);
    background: ${cssVar.colorInfoBg};

    &:hover {
      color: ${cssVar.colorInfo};
    }
  `,
  custom: css`
    color: color-mix(in srgb, ${cssVar.colorWarning} 75%, transparent);
    background: ${cssVar.colorWarningBg};

    &:hover {
      color: ${cssVar.colorWarning};
    }
  `,
  official: css`
    color: color-mix(in srgb, ${cssVar.colorSuccess} 75%, transparent);
    background: ${cssVar.colorSuccessBg};

    &:hover {
      color: ${cssVar.colorSuccess};
    }
  `,
}));

interface PluginTagProps extends Pick<InstallPluginMeta, 'author' | 'type'> {
  showIcon?: boolean;
  showText?: boolean;
}

const PluginTag = memo<PluginTagProps>(({ showIcon = true, author, type, showText = true }) => {
  const { t } = useTranslation('plugin');
  const isCustom = type === 'customPlugin';
  const isOfficial = author === 'LobeHub';

  return (
    <Tag
      className={cx(isCustom ? styles.custom : isOfficial ? styles.official : styles.community)}
      icon={showIcon && <Icon icon={isCustom ? Package : isOfficial ? BadgeCheck : CircleUser} />}
    >
      {showText && (author || t(isCustom ? 'store.customPlugin' : 'store.communityPlugin'))}
    </Tag>
  );
});

export default PluginTag;
