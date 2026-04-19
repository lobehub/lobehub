import { Flexbox, Icon, Skeleton, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar, keyframes, useTheme } from 'antd-style';
import { HashIcon, MessageSquareDashed } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import DotsLoading from '@/components/DotsLoading';
import RingLoadingIcon from '@/components/RingLoading';
import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import NavItem from '@/features/NavPanel/components/NavItem';
import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import type { ChatTopicMetadata } from '@/types/topic';

import { useTopicNavigation } from '../../hooks/useTopicNavigation';
import ThreadList from '../../TopicListContent/ThreadList';
import Actions from './Actions';
import Editing from './Editing';
import { useTopicItemDropdownMenu } from './useDropdownMenu';

const rippleAnim = keyframes`
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
`;

const styles = createStaticStyles(({ css }) => ({
  unreadWrapper: css`
    position: relative;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
  `,
  unreadDot: css`
    position: relative;
    z-index: 1;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorInfo};
  `,
  unreadRipple: css`
    position: absolute;
    inset: 0;

    width: 6px;
    height: 6px;
    margin: auto;
    border: 1px solid ${cssVar.colorInfo};
    border-radius: 50%;

    background: transparent;

    animation: ${rippleAnim} 1.8s ease-out infinite;
  `,
}));

interface TopicItemProps {
  active?: boolean;
  fav?: boolean;
  id?: string;
  metadata?: ChatTopicMetadata;
  threadId?: string;
  title: string;
}

const TopicItem = memo<TopicItemProps>(({ id, title, fav, active, threadId, metadata }) => {
  const { t } = useTranslation('topic');
  const { isDarkMode } = useTheme();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const addTab = useElectronStore((s) => s.addTab);

  const loadingRingColor = isDarkMode
    ? cssVar.colorWarningBorder
    : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

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

  const { focusTopicPopup, navigateToTopic, isInAgentSubRoute } = useTopicNavigation();

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useChatStore.setState({ topicRenamingId: visible && id ? id : '' });
    },
    [id],
  );

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (editing) return;
    if (isDesktop) {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        void navigateToTopic(id);
      }, 250);
    } else {
      void navigateToTopic(id);
    }
  }, [editing, id, navigateToTopic]);

  const handleDoubleClick = useCallback(async () => {
    if (!id || !activeAgentId || !isDesktop) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (await focusTopicPopup(id)) {
      void navigateToTopic(id, { skipPopupFocus: true });
      return;
    }
    const reference = pluginRegistry.parseUrl(`/agent/${activeAgentId}`, `topic=${id}`);
    if (reference) {
      addTab(reference);
      void navigateToTopic(id);
    }
  }, [id, activeAgentId, addTab, focusTopicPopup, navigateToTopic]);

  const { dropdownMenu } = useTopicItemDropdownMenu({
    fav,
    id,
    title,
  });

  const hasUnread = id && isUnreadCompleted;
  const unreadIcon = (
    <span className={styles.unreadWrapper}>
      <span className={styles.unreadRipple} />
      <span className={styles.unreadDot} />
    </span>
  );

  // For default topic (no id)
  if (!id) {
    return (
      <NavItem
        active={active && !isInAgentSubRoute}
        icon={
          isLoading ? (
            <RingLoadingIcon
              ringColor={loadingRingColor}
              size={14}
              style={{ color: cssVar.colorWarning }}
            />
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
    <Flexbox data-testid="topic-item" style={{ position: 'relative' }}>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !threadId && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        href={href}
        title={title === '...' ? <DotsLoading gap={3} size={4} /> : title}
        icon={(() => {
          if (isLoading) {
            return (
              <RingLoadingIcon
                ringColor={loadingRingColor}
                size={14}
                style={{ color: cssVar.colorWarning }}
              />
            );
          }
          if (hasUnread) return unreadIcon;
          if (metadata?.bot?.platform) {
            const ProviderIcon = getPlatformIcon(metadata.bot!.platform);
            if (ProviderIcon) {
              return <ProviderIcon color={cssVar.colorTextDescription} size={16} />;
            }
          }
          return (
            <Icon icon={HashIcon} size={'small'} style={{ color: cssVar.colorTextDescription }} />
          );
        })()}
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
