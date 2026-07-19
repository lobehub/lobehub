import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import BriefCardActions from '@/features/DailyBrief/BriefCardActions';
import BriefCardArtifacts from '@/features/DailyBrief/BriefCardArtifacts';
import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { type BriefItem } from '@/features/DailyBrief/types';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Time from '@/routes/(main)/home/features/components/Time';

import StatusGlyph from './StatusGlyph';

const styles = createStaticStyles(({ css, cssVar }) => ({
  meta: css`
    cursor: pointer;
  `,
  taskName: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  taskRef: css`
    flex: none;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface InboxBriefCardProps {
  brief: BriefItem;
}

/**
 * One row of "Needs you". The meta line (what state, which task, when) sits on
 * top spanning the full width; the agent avatar sits next to the *content* it
 * produced, not next to the metadata.
 */
const InboxBriefCard = memo<InboxBriefCardProps>(({ brief }) => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();

  const agent = brief.agent;
  const isInbox = agent?.id === INBOX_SESSION_ID;
  const canNavigate = Boolean(brief.taskId);

  const hasTaskMeta = Boolean(brief.taskStatus || brief.taskIdentifier || brief.taskName);

  const openTask = () => {
    if (!brief.taskId) return;
    navigate(taskDetailPath(brief.taskId, brief.agentId ?? undefined));
  };

  return (
    <Block
      className={briefStyles.card}
      gap={10}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      {/* A brief raised outside a task has no status / ref / name to show, which
          left the meta row as an empty band with a lone timestamp. Drop the row
          entirely in that case and let the title line carry the time. */}
      {hasTaskMeta && (
        <Flexbox
          horizontal
          align={'center'}
          className={canNavigate ? styles.meta : undefined}
          gap={7}
          onClick={canNavigate ? openTask : undefined}
        >
          {brief.taskStatus && <StatusGlyph status={brief.taskStatus} variant={'task'} />}
          {brief.taskIdentifier && <span className={styles.taskRef}>{brief.taskIdentifier}</span>}
          {brief.taskName && <span className={styles.taskName}>{brief.taskName}</span>}
          <Flexbox flex={1} />
          <Time date={brief.createdAt} />
        </Flexbox>
      )}

      <Flexbox horizontal align={'flex-start'} gap={10}>
        {agent && (
          <Avatar
            avatar={agent.avatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR)}
            background={agent.backgroundColor || cssVar.colorBgContainer}
            shape={'circle'}
            size={28}
            style={{ flex: 'none' }}
            title={
              agent.title || (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession'))
            }
          />
        )}
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
              {brief.title}
            </Text>
            {!hasTaskMeta && <Time date={brief.createdAt} />}
          </Flexbox>
          <BriefCardSummary summary={brief.summary} />
          <BriefCardArtifacts artifacts={brief.artifacts} />
        </Flexbox>
      </Flexbox>

      <BriefCardActions
        actions={brief.actions}
        briefId={brief.id}
        briefType={brief.type}
        resolvedAction={brief.resolvedAction}
        taskId={brief.taskId}
        taskStatus={brief.taskStatus}
        topicId={brief.topicId}
      />
    </Block>
  );
});

export default InboxBriefCard;
