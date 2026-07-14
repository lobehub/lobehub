import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import BriefIcon from '@/features/DailyBrief/BriefIcon';
import { type BriefItem } from '@/features/DailyBrief/types';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Time from '@/routes/(main)/home/features/components/Time';
import { useBriefStore } from '@/store/brief';

const styles = createStaticStyles(({ css, cssVar }) => ({
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    cursor: pointer;
    padding-block: 11px;
    padding-inline: 14px;
    transition: background ${cssVar.motionDurationFast};

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

interface NewsListProps {
  news: BriefItem[];
}

/**
 * `insight` briefs: the agent found something worth knowing, but there is
 * nothing to decide. One line each — the summary lives behind the click, so a
 * week of findings still fits on screen.
 */
const NewsList = memo<NewsListProps>(({ news }) => {
  const navigate = useWorkspaceAwareNavigate();
  const markBriefRead = useBriefStore((s) => s.markBriefRead);

  if (news.length === 0) return null;

  return (
    <Flexbox className={styles.list}>
      {news.map((brief) => (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.row}
          gap={10}
          key={brief.id}
          onClick={() => {
            void markBriefRead(brief.id);
            if (brief.taskId) navigate(taskDetailPath(brief.taskId, brief.agentId ?? undefined));
          }}
        >
          <BriefIcon muted={Boolean(brief.readAt)} type={brief.type} />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={brief.readAt ? 400 : 500}>
            {brief.title}
          </Text>
          {brief.agent?.avatar && (
            <Avatar
              avatar={brief.agent.avatar}
              background={brief.agent.backgroundColor || cssVar.colorBgContainer}
              shape={'circle'}
              size={20}
              style={{ flex: 'none' }}
              title={brief.agent.title ?? undefined}
            />
          )}
          <Time date={brief.createdAt} />
          <Icon color={cssVar.colorTextQuaternary} icon={ChevronRightIcon} size={14} />
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default NewsList;
