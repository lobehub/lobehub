import type { LinearIssueStateType } from '@lobechat/types';
import { cssVar, Icon } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  CircleArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CircleXIcon,
} from 'lucide-react';
import { memo } from 'react';

/** Linear's state categories drawn the way Linear draws them: shape first, color second. */
const STATE_ICONS: Record<LinearIssueStateType, { color: string; icon: LucideIcon }> = {
  backlog: { color: cssVar.colorTextQuaternary, icon: CircleDashedIcon },
  canceled: { color: cssVar.colorTextQuaternary, icon: CircleXIcon },
  completed: { color: cssVar.colorSuccess, icon: CircleCheckIcon },
  started: { color: cssVar.colorWarning, icon: CircleDotIcon },
  triage: { color: cssVar.colorInfo, icon: CircleArrowRightIcon },
  unstarted: { color: cssVar.colorTextTertiary, icon: CircleIcon },
};

interface StateIconProps {
  /** Next to a text label already naming the state: hidden from screen readers. */
  decorative?: boolean;
  /** The team's own state name, e.g. "In Review"; read out and shown on hover. */
  name: string;
  type: LinearIssueStateType;
}

const StateIcon = memo<StateIconProps>(({ decorative, name, type }) => {
  const { color, icon } = STATE_ICONS[type] ?? STATE_ICONS.unstarted;
  if (decorative) {
    return (
      <span aria-hidden style={{ display: 'inline-flex' }}>
        <Icon color={color} icon={icon} size={14} />
      </span>
    );
  }
  return (
    <span aria-label={name} role={'img'} style={{ display: 'inline-flex' }} title={name}>
      <Icon color={color} icon={icon} size={14} />
    </span>
  );
});

StateIcon.displayName = 'LinearStateIcon';

export default StateIcon;
