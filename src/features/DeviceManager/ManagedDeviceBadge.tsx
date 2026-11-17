'use client';

import { Icon, Tag, Tooltip } from '@lobehub/ui';
import { CloudIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Marks a managed cloud device among the machines a user connected themselves. */
const ManagedDeviceBadge = () => {
  const { t } = useTranslation('setting');

  return (
    <Tooltip title={t('devices.managed.badgeTooltip')}>
      <Tag color={'info'} icon={<Icon icon={CloudIcon} />} size={'small'}>
        {t('devices.managed.badge')}
      </Tag>
    </Tooltip>
  );
};

export default ManagedDeviceBadge;
