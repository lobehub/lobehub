import { ActionIcon, Flexbox, Icon, Skeleton, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquareDashed, Star } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

import { useTopicNavigation } from '../../hooks/useTopicNavigation';
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
}));

interface TopicItemProps {
  active?: boolean;
  fav?: boolean;
  id?: string;
  threadId?: string;
  title: string;
}

const TopicItem = memo<TopicItemProps>(({ id, title, fav, active, threadId }) => {
  const { t } = useTranslation('topic');
  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  // Construct href for cmd+click support
  const href = useMemo(() => {
    if (!activeAgentId || !id) return undefined;
    return `/agent/${activeAgentId}?topic=${id}`;
  }, [activeAgentId, id]);

  const [editing, isLoading] = useChatStore((s) => [
    id ? s.topicRenamingId === id : false,
    id ? s.topicLoadingIds.includes(id) : false,
  ]);

  const isUnreadCompleted = useChatStore(
    id ? operationSelectors.isTopicUnreadCompleted(id) : () => false,
  );

  const [favoriteTopic] = useChatStore((s) => [s.favoriteTopic]);

  const { navigateToTopic, isInAgentSubRoute } = useTopicNavigation();

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useChatStore.setState({ topicRenamingId: visible && id ? id : '' });
    },
    [id],
  );

  const handleClick = useCallback(() => {
    if (editing) return;
    navigateToTopic(id);
  }, [editing, id, navigateToTopic]);

  const handleDoubleClick = useCallback(() => {
    if (!id || !activeAgentId) return;
    if (isDesktop) {
      openTopicInNewWindow(activeAgentId, id);
    }
  }, [id, activeAgentId, openTopicInNewWindow]);

  const dropdownMenu = useTopicItemDropdownMenu({
    id,
    toggleEditing,
  });

  const hasUnread = id && isUnreadCompleted;
  const successColor = cssVar.colorSuccess;
  const unreadNode = (
    <span className={styles.dotContainer} style={{ width: hasUnread ? 18 : 0 }}>
      <AnimatePresence mode="popLayout">
        {hasUnread && (
          <motion.div
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
            <motion.span
              initial={false}
              animate={{
                scale: [1, 1.3, 1],
                opacity: [1, 0.9, 1],
                boxShadow: [
                  `0 0 3px ${successColor}, 0 0 6px ${successColor}`,
                  `0 0 5px ${successColor}, 0 0 8px color-mix(in srgb, ${successColor} 60%, transparent)`,
                  `0 0 3px ${successColor}, 0 0 6px ${successColor}`,
                ],
              }}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: successColor,
                boxShadow: `0 0 3px ${successColor}, 0 0 6px ${successColor}`,
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );

  // For default topic (no id)
  if (!id) {
    return (
      <NavItem
        active={active && !isInAgentSubRoute}
        loading={isLoading}
        icon={
          <Icon color={cssVar.colorTextDescription} icon={MessageSquareDashed} size={'small'} />
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
        active={active && !threadId && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        href={href}
        loading={isLoading}
        title={title}
        icon={
          <ActionIcon
            color={fav ? cssVar.colorWarning : undefined}
            fill={fav ? cssVar.colorWarning : 'transparent'}
            icon={Star}
            size={'small'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              favoriteTopic(id, !fav);
            }}
          />
        }
        slots={{
          iconPostfix: unreadNode,
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
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
