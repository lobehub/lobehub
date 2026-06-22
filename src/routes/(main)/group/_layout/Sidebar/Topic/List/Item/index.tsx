import type { ChatTopicStatus } from '@lobechat/types';
import { Flexbox, Icon, Skeleton, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CheckCircle2,
  Hand,
  HashIcon,
  Loader2Icon,
  MessageSquareDashed,
  TriangleAlert,
} from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DotsLoading from '@/components/DotsLoading';
import { isDesktop } from '@/const/version';
import { useHasDraft } from '@/features/ChatInput/draftStorage';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useFocusTopicPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

import ThreadList from '../../TopicListContent/ThreadList';
import Actions from './Actions';
import Editing from './Editing';
import { useTopicItemDropdownMenu } from './useDropdownMenu';

const styles = createStaticStyles(({ css }) => ({
  neonDotWrapper: css`
    position: absolute;
    inset: 0;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
  `,
  dotContainer: css`
    will-change: width;

    position: relative;

    width: 18px;
    height: 18px;
    margin-inline-start: -6px;

    transition: width 0.2s ${cssVar.motionEaseOut};
  `,
  neonDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorInfo};
    box-shadow:
      0 0 3px ${cssVar.colorInfo},
      0 0 6px ${cssVar.colorInfo};
  `,
}));

// Module-scoped so a click on any topic cancels a pending click on another.
// Per-item refs can't do that, which lets rapid clicks across items all
// fire — each racing to write activeTopicId (see ).
let pendingSingleClickTimer: ReturnType<typeof setTimeout> | null = null;

const cancelPendingSingleClick = () => {
  if (pendingSingleClickTimer) {
    clearTimeout(pendingSingleClickTimer);
    pendingSingleClickTimer = null;
  }
};

interface TopicItemProps {
  active?: boolean;
  fav?: boolean;
  id?: string;
  status?: ChatTopicStatus | null;
  threadId?: string;
  title: string;
}

const TopicItem = memo<TopicItemProps>(({ id, title, fav, active, threadId, status }) => {
  const { t } = useTranslation('topic');
  const toggleMobileTopic = useGlobalStore((s) => s.toggleMobileTopic);
  const [activeGroupId, switchTopic] = useAgentGroupStore((s) => [s.activeGroupId, s.switchTopic]);
  const addTab = useElectronStore((s) => s.addTab);
  const focusTopicPopup = useFocusTopicPopup({ groupId: activeGroupId });

  // Construct href for cmd+click support
  const href = useMemo(() => {
    if (!activeGroupId || !id) return undefined;
    return `/group/${activeGroupId}?topic=${id}`;
  }, [activeGroupId, id]);

  const [editing, isLoading] = useChatStore((s) => [
    id ? s.topicRenamingId === id : false,
    id ? s.topicLoadingIds.includes(id) : false,
  ]);

  const isUnreadCompleted = useChatStore(
    id ? operationSelectors.isTopicUnreadCompleted(id) : () => false,
  );

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useChatStore.setState({ topicRenamingId: visible && id ? id : '' });
    },
    [id],
  );

  const handleClick = useCallback(() => {
    if (editing) return;
    if (isDesktop) {
      cancelPendingSingleClick();
      pendingSingleClickTimer = setTimeout(() => {
        pendingSingleClickTimer = null;
        void (async () => {
          await focusTopicPopup(id);
          switchTopic(id);
          toggleMobileTopic(false);
        })();
      }, 250);
    } else {
      void (async () => {
        await focusTopicPopup(id);
        switchTopic(id);
        toggleMobileTopic(false);
      })();
    }
  }, [editing, focusTopicPopup, id, switchTopic, toggleMobileTopic]);

  const handleDoubleClick = useCallback(async () => {
    if (!id || !activeGroupId || !isDesktop) return;
    cancelPendingSingleClick();
    if (await focusTopicPopup(id)) {
      switchTopic(id);
      toggleMobileTopic(false);
      return;
    }
    addTab(`/group/${activeGroupId}?topic=${id}`);
    switchTopic(id);
    toggleMobileTopic(false);
  }, [id, activeGroupId, addTab, focusTopicPopup, switchTopic, toggleMobileTopic]);

  const dropdownMenu = useTopicItemDropdownMenu({
    id,
    status,
    toggleEditing,
  });

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const isRunning = status === 'running';
  const isWaitingForHuman = status === 'waitingForHuman';

  const hasUnread = id && isUnreadCompleted;
  const infoColor = cssVar.colorInfo;
  const unreadNode = (
    <span className={styles.dotContainer} style={{ width: hasUnread ? 18 : 0 }}>
      <AnimatePresence mode="popLayout">
        {hasUnread && (
          <m.div
            className={styles.neonDotWrapper}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: 1,
              opacity: 1,
            }}
            exit={{
              scale: 0,
              opacity: 0,
            }}
          >
            <m.span
              className={styles.neonDot}
              initial={false}
              animate={{
                scale: [1, 1.3, 1],
                opacity: [1, 0.9, 1],
                boxShadow: [
                  `0 0 3px ${infoColor}, 0 0 6px ${infoColor}`,
                  `0 0 5px ${infoColor}, 0 0 8px color-mix(in srgb, ${infoColor} 60%, transparent)`,
                  `0 0 3px ${infoColor}, 0 0 6px ${infoColor}`,
                ],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </m.div>
        )}
      </AnimatePresence>
    </span>
  );

  // Surface a WeChat-style red "[Draft]" hint when this topic holds unsent
  // input. Group drafts live in localStorage keyed by messageMapKey under the
  // group scope; the default topic (no id) maps to the new-topic draft.
  const draftKey = useMemo(
    () =>
      activeGroupId
        ? messageMapKey({ agentId: '', groupId: activeGroupId, scope: 'group', topicId: id })
        : undefined,
    [activeGroupId, id],
  );
  const hasDraft = useHasDraft(draftKey);
  const draftPrefix = hasDraft ? (
    <Text fontSize={12} style={{ color: cssVar.colorError, flex: 'none' }}>
      {t('draft')}
    </Text>
  ) : undefined;

  // For default topic (no id)
  if (!id) {
    return (
      <NavItem
        active={active}
        slots={{ titlePrefix: draftPrefix }}
        titleColor={cssVar.colorText}
        icon={
          isLoading ? (
            <Icon spin color={cssVar.colorWarning} icon={Loader2Icon} size={'small'} />
          ) : (
            <Icon color={cssVar.colorTextDescription} icon={MessageSquareDashed} size={'small'} />
          )
        }
        title={
          <Flexbox horizontal align={'center'} flex={1} gap={6}>
            {t('defaultTitle')}
            <Tag
              size={'small'}
              style={{
                color: cssVar.colorTextDescription,
                fontSize: 10,
              }}
            >
              {t('temp')}
            </Tag>
          </Flexbox>
        }
        onClick={handleClick}
      />
    );
  }

  return (
    <Flexbox style={{ position: 'relative' }}>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !threadId}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        href={!editing ? href : undefined}
        title={title === '...' ? <DotsLoading gap={3} size={4} /> : title}
        titleColor={cssVar.colorText}
        icon={(() => {
          if (isWaitingForHuman) {
            return <Icon icon={Hand} size={'small'} style={{ color: cssVar.colorInfo }} />;
          }
          if (isLoading || isRunning) {
            return (
              <Icon spin icon={Loader2Icon} size={'small'} style={{ color: cssVar.colorWarning }} />
            );
          }
          if (isFailed) {
            return (
              <Tooltip title={t('failedStatusTip')}>
                <Icon icon={TriangleAlert} size={'small'} style={{ color: cssVar.colorError }} />
              </Tooltip>
            );
          }
          if (isCompleted) {
            return (
              <Icon
                icon={CheckCircle2}
                size={'small'}
                style={{ color: cssVar.colorTextDescription }}
              />
            );
          }
          return (
            <Icon icon={HashIcon} size={'small'} style={{ color: cssVar.colorTextDescription }} />
          );
        })()}
        slots={{
          iconPostfix: unreadNode,
          titlePrefix: draftPrefix,
        }}
        onClick={handleClick}
        onDoubleClick={() => void handleDoubleClick()}
      />
      <Editing id={id} title={title} toggleEditing={toggleEditing} />
      {active && (
        <Suspense
          fallback={
            <Flexbox gap={8} paddingBlock={8} paddingInline={24} width={'100%'}>
              <Skeleton.Button active size={'small'} style={{ height: 18, width: '100%' }} />
              <Skeleton.Button active size={'small'} style={{ height: 18, width: '100%' }} />
            </Flexbox>
          }
        >
          <ThreadList />
        </Suspense>
      )}
    </Flexbox>
  );
});

export default TopicItem;
