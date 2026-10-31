import { cssVar, Icon, Tooltip } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getTaskVisibilityDefaultLabel,
  getTaskVisibilityLabelKey,
} from '@/features/AgentTasks/features/taskVisibilityLabel';

interface GoalPrivateMarkProps {
  goal: { visibility?: 'private' | 'public' | null; workspaceId: string | null };
}

/** A lock next to a private workspace goal's title; personal goals are private by nature. */
const GoalPrivateMark = memo<GoalPrivateMarkProps>(({ goal }) => {
  const { t } = useTranslation('chat');
  if (!goal.workspaceId || goal.visibility !== 'private') return null;

  return (
    <Tooltip
      title={t(getTaskVisibilityLabelKey('private') as never, {
        defaultValue: getTaskVisibilityDefaultLabel('private'),
      })}
    >
      <Icon
        color={cssVar.colorTextDescription}
        icon={LockIcon}
        size={14}
        style={{ flex: 'none' }}
      />
    </Tooltip>
  );
});

GoalPrivateMark.displayName = 'GoalPrivateMark';

export default GoalPrivateMark;
