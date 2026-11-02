import { cssVar, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PriorityLowIcon from '@/features/AgentTasks/features/icons/PriorityLowIcon';
import PriorityMediumIcon from '@/features/AgentTasks/features/icons/PriorityMediumIcon';
import PriorityUrgentIcon from '@/features/AgentTasks/features/icons/PriorityUrgentIcon';

import { type BriefPriority, resolveBriefPriority } from './briefPriority';

/** Same glyphs and urgent orange as task priority, so one scale reads everywhere. */
const PRIORITY_ICON = {
  info: PriorityLowIcon,
  normal: PriorityMediumIcon,
  urgent: PriorityUrgentIcon,
} satisfies Record<BriefPriority, unknown>;

interface BriefPriorityIconProps {
  /** A read or handled row recedes as one — urgent included: once handled it no longer needs you. */
  muted?: boolean;
  priority: string | null | undefined;
  size?: number;
}

const BriefPriorityIcon = memo<BriefPriorityIconProps>(({ muted, priority, size = 14 }) => {
  const { t } = useTranslation('home');
  const level = resolveBriefPriority(priority);
  const PriorityIcon = PRIORITY_ICON[level];
  const color = muted
    ? cssVar.colorTextQuaternary
    : level === 'urgent'
      ? cssVar.orange
      : cssVar.colorTextDescription;

  return (
    <Tooltip title={t(`inbox.priority.${level}`)}>
      {/* The svg glyph forwards no ref, so the tooltip anchors on this span. */}
      <span
        aria-label={t(`inbox.priority.${level}`)}
        role={'img'}
        style={{ color, display: 'inline-flex', flex: 'none' }}
      >
        <PriorityIcon size={size} />
      </span>
    </Tooltip>
  );
});

export default BriefPriorityIcon;
