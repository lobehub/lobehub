import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { ActionIcon, Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { Check, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import Time from '@/routes/(main)/home/features/components/Time';

import BriefCardActions from './BriefCardActions';
import BriefCardArtifacts from './BriefCardArtifacts';
import BriefCardSummary from './BriefCardSummary';
import BriefIcon from './BriefIcon';
import { styles } from './style';
import { type AgentAvatarInfo, type BriefItem } from './types';

interface AgentAvatarsProps {
  agents: AgentAvatarInfo[];
}

const AgentAvatars = memo<AgentAvatarsProps>(({ agents }) => {
  const { t } = useTranslation('common');
  if (agents.length === 0) return null;

  return (
    <Avatar.Group
      shadow
      size={28}
      items={agents.map((agent, index) => {
        const isInbox = agent?.id === INBOX_SESSION_ID;
        return {
          avatar: agent?.avatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
          background: agent.backgroundColor || cssVar.colorBgContainer,
          key: agent.id || index.toString(),
          title: agent?.title || (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession')),
        };
      })}
    />
  );
});

interface BriefCardProps {
  brief: BriefItem;
  /** When false, disables the header click-to-navigate behavior. */
  enableNavigation?: boolean;
  /** Hook invoked after a feedback comment is posted. */
  onAfterAddComment?: () => void | Promise<void>;
  /** Hook invoked after the brief is resolved. */
  onAfterResolve?: () => void | Promise<void>;
}

const BriefCard = memo<BriefCardProps>(
  ({ brief, enableNavigation = true, onAfterResolve, onAfterAddComment }) => {
    const navigate = useNavigate();
    const { t } = useTranslation('home');
    const isResolved = Boolean(brief.resolvedAction);
    const [expanded, setExpanded] = useState(false);
    const showFull = !isResolved || expanded;

    const canNavigate = enableNavigation && Boolean(brief.taskId);

    return (
      <Block
        className={styles.card}
        gap={12}
        padding={12}
        style={{ borderRadius: cssVar.borderRadiusLG }}
        variant={'outlined'}
      >
        <Flexbox
          horizontal
          align={'center'}
          className={canNavigate ? styles.clickableHeader : undefined}
          gap={16}
          justify={'space-between'}
          onClick={canNavigate ? () => navigate(`/task/${brief.taskId}`) : undefined}
        >
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <BriefIcon type={brief.type} />
            <Text ellipsis fontSize={16} style={{ flex: 1 }} weight={500}>
              {brief.title}
            </Text>
            <Time date={brief.createdAt} />
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            {isResolved && !expanded && (
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={cssVar.colorTextQuaternary} icon={Check} size={14} />
                <Text className={styles.resolvedTag}>{t('brief.resolved')}</Text>
              </Flexbox>
            )}
            {brief.agents.length > 0 && <AgentAvatars agents={brief.agents} />}
            {isResolved && (
              <ActionIcon
                icon={expanded ? ChevronUpIcon : ChevronDownIcon}
                size={'small'}
                title={expanded ? t('brief.collapse') : t('brief.expandAll')}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((v) => !v);
                }}
              />
            )}
          </Flexbox>
        </Flexbox>
        {showFull && (
          <>
            <Divider dashed style={{ marginBlock: 0 }} />
            <BriefCardSummary summary={brief.summary} />
            <BriefCardArtifacts artifacts={brief.artifacts} />
            <BriefCardActions
              actions={brief.actions}
              briefId={brief.id}
              briefType={brief.type}
              resolvedAction={brief.resolvedAction}
              taskId={brief.taskId}
              taskStatus={brief.taskStatus}
              topicId={brief.topicId}
              onAfterAddComment={onAfterAddComment}
              onAfterResolve={onAfterResolve}
            />
          </>
        )}
      </Block>
    );
  },
);

export default BriefCard;
