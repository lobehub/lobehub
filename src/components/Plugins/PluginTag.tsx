import { Icon, Tag } from '@lobehub/ui';
import { BadgeCheck, CircleUser, Package } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PluginTagProps {
  author?: string;
  isMCP?: boolean;
  showIcon?: boolean;
  showText?: boolean;
  type: 'builtin' | 'customPlugin' | 'plugin';
}

const PluginTag = memo<PluginTagProps>(({ showIcon = true, author, type, showText = true }) => {
  const { t } = useTranslation('plugin');
  const isCustom = type === 'customPlugin';
  const isOfficial = author === 'LobeHub';

  const customTag = (
    <Tag color={'warning'} icon={showIcon && <Icon icon={Package} />} size={'small'}>
      {t('store.customPlugin')}
    </Tag>
  );

  if (isCustom) return customTag;

  return (
    <Tag
      color={isOfficial ? 'success' : undefined}
      icon={showIcon && <Icon icon={isOfficial ? BadgeCheck : CircleUser} />}
      size={'small'}
    >
      {showText && (author || t('store.communityPlugin'))}
    </Tag>
  );
});

export default PluginTag;
