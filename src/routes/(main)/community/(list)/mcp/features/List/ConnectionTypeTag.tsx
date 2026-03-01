import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Blend, Cloud, LaptopMinimalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ConnectionTypeTagProps {
  type?: 'hybrid' | 'local' | 'remote';
}

const ConnectionTypeTag = memo<ConnectionTypeTagProps>(({ type }) => {
  const { t } = useTranslation('discover');

  const icons = {
    hybrid: {
      color: cssVar.purple,
      icon: Blend,
    },
    local: {
      color: cssVar.colorWarning,
      icon: LaptopMinimalIcon,
    },
    remote: {
      color: cssVar.colorInfo,
      icon: Cloud,
    },
  };

  if (!type || !icons[type]) return null;

  return (
    <Tooltip title={t(`mcp.details.connectionType.${type}.desc`)}>
      <Flexbox
        horizontal
        align={'center'}
        gap={6}
        style={{
          color: cssVar.colorTextSecondary,
          fontSize: 12,
        }}
      >
        <Icon color={icons[type].color} icon={icons[type].icon} size={14} />
        {t(`mcp.details.connectionType.${type}.title`)}
      </Flexbox>
    </Tooltip>
  );
});

export default ConnectionTypeTag;
