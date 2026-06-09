import { Flexbox, Skeleton } from '@lobehub/ui';
import dayjs from 'dayjs';
import { Clock3Icon, ClockArrowUp, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import { formatIntergerNumber } from '@/utils/format';

import TimeLabel from '../components/TimeLabel';

const formatEnglishNumber = (number: number) => {
  if (number === 1) return '1st';
  if (number === 2) return '2nd';
  if (number === 3) return '3rd';
  return `${formatIntergerNumber(number)}th`;
};

const WorkspaceWelcome = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t, i18n } = useTranslation('auth');
  const { t: tSetting } = useTranslation('setting');
  const workspace = useActiveWorkspace();
  const members = useWorkspaceMembers();

  if (!workspace) {
    return <Skeleton.Button active style={{ height: 24, minWidth: 200, width: 200 }} />;
  }

  const days = Math.max(1, dayjs().diff(dayjs(workspace.createdAt), 'day'));
  const memberCount = members.length;

  return (
    <Flexbox padding={mobile ? 16 : 0}>
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        wrap={'wrap'}
        style={{
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        <Trans
          i18nKey="stats.workspace.welcome"
          ns={'auth'}
          components={{
            span: <span style={{ fontWeight: 'bold' }} />,
          }}
          values={{
            days:
              i18n.language === 'en-US' ? formatEnglishNumber(days) : formatIntergerNumber(days),
            name: workspace.name,
          }}
        />
      </Flexbox>
      <Flexbox horizontal gap={16} wrap={'wrap'}>
        <TimeLabel
          date={String(memberCount)}
          icon={UsersIcon}
          title={tSetting('workspaceSetting.tab.members')}
        />
        <TimeLabel
          date={dayjs(workspace.createdAt).format('YYYY-MM-DD')}
          icon={Clock3Icon}
          title={t('stats.createdAt')}
        />
        <TimeLabel
          date={dayjs(workspace.updatedAt).format('YYYY-MM-DD')}
          icon={ClockArrowUp}
          title={t('stats.updatedAt')}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default WorkspaceWelcome;
