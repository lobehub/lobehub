import type { TaskDetailActivity } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Markdown,
  stopPropagation,
  Tag,
  Text,
} from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleStop,
  Copy,
  ExternalLink,
  MoreHorizontal,
  SquarePen,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CollapsibleContent from '@/components/CollapsibleContent';
import { DEFAULT_AVATAR } from '@/const/meta';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { useActivityTime } from '@/hooks/useActivityTime';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from '../shared/style';
import RunReplyEditor from './RunReplyEditor';
import RunVerifyDetail from './RunVerifyDetail';
import RunVerifyTag from './RunVerifyTag';
import TopicStatusIcon from './TopicStatusIcon';

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

// The run's last message (`content`) is the raw assistant output — markdown, and
// often long. Render it as rich text, but keep it a bounded preview in the feed:
// the shared collapse clamps it with a fade and offers "show more", while the
// run drawer remains available from the explicit overflow action. The preview
// itself is reading content, not an unlabeled navigation target.
//
// It also stays interactive. While the whole card was one big button to the run
// drawer, the body carried `pointer-events: none` so clicks fell through to it;
// the card stopped being that button, and the rule was left behind killing every
// link, code-copy and text selection in the output with nothing to fall through
// to. Anything added here that swallows clicks has to earn it again.
const RUN_CONTENT_MAX_HEIGHT = 160;

const RunContent = memo<{ content: string }>(({ content }) => (
  <CollapsibleContent key={content} maxHeight={RUN_CONTENT_MAX_HEIGHT}>
    <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
      {content}
    </Markdown>
  </CollapsibleContent>
));

interface TopicCardProps {
  activity: TaskDetailActivity;
  /**
   * Whether the run body starts open. A goal loop can produce many rounds, and
   * an all-expanded feed buries the newest result under older ones — the list
   * opens only the latest and collapses the rest.
   */
  defaultExpanded?: boolean;
}

const TopicCard = memo<TopicCardProps>(({ activity, defaultExpanded = true }) => {
  const { t } = useTranslation('chat');
  const [bodyExpanded, setBodyExpanded] = useState(defaultExpanded);
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const cancelTopic = useTaskStore((s) => s.cancelTopic);
  const addComment = useTaskStore((s) => s.addComment);
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const { allowed: canEditTask } = usePermission('create_content');
  const [commenting, setCommenting] = useState(false);
  const isRunning = activity.status === 'running';
  // A descendant run shown in a parent detail belongs to `sourceTaskId`, not the
  // currently open parent (`activeTaskId`) — file the follow-up on the task that
  // owns the run so it appears where the run lives. Direct runs fall back to the
  // active task.
  const runTaskId = activity.sourceTaskId ?? activeTaskId;
  const canFollowUp = canEditTask && !!runTaskId;
  const hasBody = Boolean(
    activity.summary || activity.content || canFollowUp || activity.verify?.total,
  );
  // A verdict with no results behind it has nothing to move down to, so it
  // stays in the header no matter what the body is doing.
  const verifyDetailOpen = bodyExpanded && Boolean(activity.verify?.total);

  const finalDuration =
    !isRunning && activity.time && activity.completedAt
      ? new Date(activity.completedAt).getTime() - new Date(activity.time).getTime()
      : null;

  const [elapsed, setElapsed] = useState(() =>
    isRunning && activity.time ? Date.now() - new Date(activity.time).getTime() : 0,
  );

  useEffect(() => {
    if (!isRunning || !activity.time) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - new Date(activity.time!).getTime());
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, activity.time]);

  const handleOpen = useCallback(() => {
    if (activity.id) openTopicDrawer(activity.id);
  }, [activity.id, openTopicDrawer]);

  const handleCopyId = useCallback(() => {
    if (activity.id) void navigator.clipboard.writeText(activity.id);
  }, [activity.id]);

  const handleCopyOperationId = useCallback(() => {
    if (activity.operationId) void navigator.clipboard.writeText(activity.operationId);
  }, [activity.operationId]);

  const handleStop = useCallback(() => {
    if (!activity.id) return;
    const topicId = activity.id;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('taskDetail.topicMenu.stopConfirm.content', {
        defaultValue:
          'The current run will be canceled. Generated messages are kept and you can re-run the task later.',
      }),
      okText: t('taskDetail.topicMenu.stop', { defaultValue: 'Stop Run' }),
      onOk: async () => {
        await cancelTopic(topicId);
      },
      title: t('taskDetail.topicMenu.stopConfirm.title', { defaultValue: 'Stop Run?' }),
    });
  }, [activity.id, cancelTopic, t]);

  const { text: startedAt, title: startedAtTitle } = useActivityTime(activity.time);
  const durationText = isRunning
    ? formatDuration(elapsed)
    : finalDuration != null && finalDuration >= 0
      ? formatDuration(finalDuration)
      : '';

  const menuItems: DropdownItem[] = [
    ...(isRunning && activity.id
      ? [
          {
            danger: true,
            icon: CircleStop,
            key: 'stop',
            label: t('taskDetail.topicMenu.stop', { defaultValue: 'Stop Run' }),
            onClick: handleStop,
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      icon: ExternalLink,
      key: 'open',
      label: t('taskDetail.topicMenu.open', { defaultValue: 'Open Run' }),
      onClick: handleOpen,
    },
    {
      disabled: !activity.id,
      icon: Copy,
      key: 'copy',
      label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy Topic ID' }),
      onClick: handleCopyId,
    },
    {
      disabled: !activity.operationId,
      icon: Copy,
      key: 'copyOperationId',
      label: t('taskDetail.topicMenu.copyOperationId', { defaultValue: 'Copy Operation ID' }),
      onClick: handleCopyOperationId,
    },
  ];

  const isAgent = activity.author?.type === 'agent';

  // An agent that simply never set an avatar is still an agent — it gets the
  // same default face it wears everywhere else, not a placeholder dot. The dot
  // stays for rows with no author at all.
  const avatarNode =
    activity.author?.avatar || isAgent ? (
      <Avatar avatar={activity.author?.avatar || DEFAULT_AVATAR} size={24} />
    ) : (
      <div className={styles.activityAvatar}>
        <CircleDot size={12} />
      </div>
    );

  return (
    <Block
      gap={8}
      paddingBlock={8}
      paddingInline={8}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, overflow: 'hidden' }}>
          {isAgent && activity.author?.id ? (
            <AgentProfilePopup
              agent={{ avatar: activity.author.avatar, title: activity.author.name }}
              agentId={activity.author.id}
              trigger={'hover'}
            >
              {avatarNode}
            </AgentProfilePopup>
          ) : (
            avatarNode
          )}
          <TopicStatusIcon size={16} status={activity.status} />
          {activity.sourceTaskIdentifier && (
            <Tag
              size={'small'}
              style={{ flexShrink: 0 }}
              title={t('taskDetail.topicSource', { identifier: activity.sourceTaskIdentifier })}
            >
              {activity.sourceTaskIdentifier}
            </Tag>
          )}
          <Text ellipsis weight={500}>
            {activity.title}
          </Text>
          {activity.seq != null && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              #{activity.seq}
            </Text>
          )}
          {/* Only mark machine-opened rounds: a `manual` tag on every row the
              user started themselves is noise, absence already means manual. */}
          {activity.trigger && activity.trigger !== 'manual' && (
            <Tag
              size={'small'}
              style={{ flexShrink: 0 }}
              title={t(`taskDetail.runTrigger.${activity.trigger}` as const)}
            >
              {t(`taskDetail.runTrigger.${activity.trigger}` as const)}
            </Tag>
          )}
          {durationText && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              · {durationText}
            </Text>
          )}
          {/* The verdict rides the header only while the run is folded; once
              open it moves down to sit on the checklist that justifies it. */}
          {!verifyDetailOpen && <RunVerifyTag verify={activity.verify} />}
        </Flexbox>

        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          {startedAt && (
            <Text fontSize={12} title={startedAtTitle} type={'secondary'}>
              {startedAt}
            </Text>
          )}
          {hasBody && (
            <Flexbox onClick={stopPropagation}>
              <ActionIcon
                icon={bodyExpanded ? ChevronDown : ChevronRight}
                size={'small'}
                title={t(bodyExpanded ? 'taskDetail.runCollapse' : 'taskDetail.runExpand')}
                onClick={() => setBodyExpanded((open) => !open)}
              />
            </Flexbox>
          )}
          <Flexbox onClick={stopPropagation}>
            <DropdownMenu items={menuItems}>
              <ActionIcon icon={MoreHorizontal} size={'small'} />
            </DropdownMenu>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {hasBody && bodyExpanded && (
        <Flexbox gap={8} paddingInline={4}>
          {activity.summary && (
            <Text
              fontSize={13}
              style={{ color: cssVar.colorTextDescription, whiteSpace: 'pre-wrap' }}
            >
              {activity.summary}
            </Text>
          )}
          {activity.content && <RunContent content={activity.content} />}
          {/* The verdict's evidence, next to the delivery it judged — reading
              one should never require leaving for the acceptance page. */}
          {activity.verify && (
            <Flexbox onClick={stopPropagation}>
              <RunVerifyDetail
                extra={<RunVerifyTag verify={activity.verify} />}
                operationId={activity.operationId}
              />
            </Flexbox>
          )}
          {canFollowUp &&
            (commenting ? (
              <Flexbox onClick={stopPropagation}>
                <RunReplyEditor
                  onCancel={() => setCommenting(false)}
                  onSubmit={async (text) => {
                    await addComment(runTaskId!, text, { topicId: activity.id });
                    setCommenting(false);
                  }}
                />
              </Flexbox>
            ) : (
              <Flexbox horizontal justify={'flex-end'} onClick={stopPropagation}>
                <ActionIcon
                  icon={SquarePen}
                  size={'small'}
                  title={t('taskDetail.runFollowUp')}
                  onClick={() => setCommenting(true)}
                />
              </Flexbox>
            ))}
        </Flexbox>
      )}
    </Block>
  );
});

export default TopicCard;
