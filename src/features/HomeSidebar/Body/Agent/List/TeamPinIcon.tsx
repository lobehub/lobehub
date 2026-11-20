'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Marks an Agent / chat group an owner/admin pinned for the team in the merged
 * workspace Agents section, where team and personal pins share one list. Same
 * look as `@/components/PrivateLockIcon`.
 */
const TeamPinIcon = memo(() => {
  const { t } = useTranslation('common');
  const label = t('navPanel.teamPinnedTooltip');

  return (
    <Tooltip title={label}>
      <span
        aria-label={label}
        data-testid="sidebar-team-pin"
        role="img"
        style={{
          color: cssVar.colorTextTertiary,
          display: 'inline-flex',
          flex: 'none',
          verticalAlign: 'middle',
        }}
      >
        <Icon icon={UsersIcon} size={12} />
      </span>
    </Tooltip>
  );
});

TeamPinIcon.displayName = 'TeamPinIcon';

export default TeamPinIcon;
