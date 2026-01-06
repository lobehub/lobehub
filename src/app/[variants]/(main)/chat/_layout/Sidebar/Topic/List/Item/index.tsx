import { ActionIcon, Flexbox, Icon, Skeleton, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MessageSquareDashed, Star } from 'lucide-react';
import { Suspense, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import ThreadList from '../../TopicListContent/ThreadList';
import { useTopicNavigation } from '../../hooks/useTopicNavigation';
import Actions from './Actions';
import Editing from './Editing';
import { useTopicItemDropdownMenu } from './useDropdownMenu';

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

  const [editing, isLoading] = useChatStore((s) => [
    id ? s.topicRenamingId === id : false,
    id ? s.topicLoadingIds.includes(id) : false,
  ]);

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

  // For default topic (no id)
  if (!id) {
    return (
      <NavItem
        active={active && !isInAgentSubRoute}
        icon={
          <Icon color={cssVar.colorTextDescription} icon={MessageSquareDashed} size={'small'} />
        }
        loading={isLoading}
        onClick={handleClick}
        title={
          <Flexbox align={'center'} flex={1} gap={6} horizontal>
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
        icon={
          <ActionIcon
            color={fav ? cssVar.colorWarning : undefined}
            fill={fav ? cssVar.colorWarning : 'transparent'}
            icon={Star}
            onClick={(e) => {
              e.stopPropagation();
              favoriteTopic(id, !fav);
            }}
            size={'small'}
          />
        }
        loading={isLoading}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={title}
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
