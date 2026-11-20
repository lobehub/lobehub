'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Marks a private row in a workspace list that shows private and shared rows
 * together: the sidebar's Agents section, and the device, subscription
 * account, environment and credential settings lists.
 */
const PrivateLockIcon = memo(() => {
  const { t } = useTranslation('common');
  const label = t('navPanel.privateTooltip');

  return (
    <Tooltip title={label}>
      <span
        aria-label={label}
        data-testid="private-lock"
        role="img"
        style={{
          color: cssVar.colorTextTertiary,
          display: 'inline-flex',
          flex: 'none',
          verticalAlign: 'middle',
        }}
      >
        <Icon icon={LockIcon} size={12} />
      </span>
    </Tooltip>
  );
});

PrivateLockIcon.displayName = 'PrivateLockIcon';

export default PrivateLockIcon;
