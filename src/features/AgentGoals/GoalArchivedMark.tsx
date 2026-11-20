import { cssVar, Icon, Tooltip } from '@lobehub/ui';
import { ArchiveIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface GoalArchivedMarkProps {
  goal: { archivedAt?: Date | string | null };
}

/** An archive box next to an archived goal's title, like an archived task row. */
const GoalArchivedMark = memo<GoalArchivedMarkProps>(({ goal }) => {
  const { t } = useTranslation('chat');
  if (!goal.archivedAt) return null;

  return (
    <Tooltip title={t('goalList.archived')}>
      <Icon
        color={cssVar.colorTextDescription}
        icon={ArchiveIcon}
        size={14}
        style={{ flex: 'none' }}
      />
    </Tooltip>
  );
});

GoalArchivedMark.displayName = 'GoalArchivedMark';

export default GoalArchivedMark;
