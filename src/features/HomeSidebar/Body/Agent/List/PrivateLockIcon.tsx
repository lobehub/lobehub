'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Marks a private Agent / chat group / folder in the merged workspace Agents
 * section, where private and shared rows are listed together.
 */
const PrivateLockIcon = memo(() => {
  const { t } = useTranslation('common');
  const label = t('navPanel.privateTooltip');

  return (
    <Tooltip title={label}>
      <span
        aria-label={label}
        data-testid="sidebar-private-lock"
        role="img"
        style={{
          color: cssVar.colorTextTertiary,
          display: 'inline-flex',
          flex: 'none',
          marginInlineStart: 4,
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
