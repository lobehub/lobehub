'use client';

import { ActionIcon, DropdownMenu, Empty } from '@lobehub/ui';
import { BotIcon, MoreHorizontal, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useDiscoverStore } from '@/store/discover';
import { type StarterMode } from '@/store/home';
import { AssistantCategory } from '@/types/discover';

import GroupBlock from '../components/GroupBlock';
import GroupSkeleton from '../components/GroupSkeleton';
import ScrollShadowWithButton from '../components/ScrollShadowWithButton';
import { RECENT_BLOCK_SIZE } from '../const';
import AssistantList from './AssistantList';
import GroupList from './GroupList';

interface CommunityRecommendProps {
  mode: StarterMode;
}

const CommunityRecommend = memo<CommunityRecommendProps>(({ mode }) => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();

  const isGroupMode = mode === 'group';

  // Fetch data to check loading and empty state
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useGroupAgentList = useDiscoverStore((s) => s.useGroupAgentList);

  const category = mode === 'write' ? AssistantCategory.CopyWriting : undefined;

  const { data: assistantList, isLoading: isAssistantLoading } = useAssistantList(
    !isGroupMode ? { category, page: 1, pageSize: 12 } : undefined,
  );
  const { data: groupList, isLoading: isGroupLoading } = useGroupAgentList(
    isGroupMode ? { page: 1, pageSize: 12 } : undefined,
  );

  // Don't render if mode is invalid
  if (!mode || !['agent', 'group', 'write'].includes(mode)) {
    return null;
  }

  const isLoading = isGroupMode ? isGroupLoading : isAssistantLoading;
  const hasData = isGroupMode
    ? groupList && groupList.items.length > 0
    : assistantList && assistantList.items.length > 0;

  const getTitle = () => {
    switch (mode) {
      case 'agent': {
        return t('home.recommendAgents');
      }
      case 'group': {
        return t('home.recommendGroups');
      }
      case 'write': {
        return t('home.recommendWritingAgents');
      }
      default: {
        return '';
      }
    }
  };

  const getMorePath = () => {
    switch (mode) {
      case 'agent': {
        return '/community/agent';
      }
      case 'group': {
        return '/community/agent?includeAgentGroup=true';
      }
      case 'write': {
        return '/community/agent?category=copywriting';
      }
      default: {
        return '/community/agent';
      }
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <GroupSkeleton
          height={RECENT_BLOCK_SIZE.AGENT.HEIGHT}
          width={RECENT_BLOCK_SIZE.AGENT.WIDTH}
        />
      );
    }

    if (!hasData) {
      return (
        <Empty
          description={t('home.recommendEmpty')}
          icon={isGroupMode ? UsersIcon : BotIcon}
          style={{ padding: '24px 0' }}
        />
      );
    }

    return isGroupMode ? <GroupList /> : <AssistantList mode={mode} />;
  };

  return (
    <GroupBlock
      icon={isGroupMode ? UsersIcon : BotIcon}
      title={getTitle()}
      action={
        <DropdownMenu
          items={[
            {
              key: 'more',
              label: t('home.more'),
              onClick: () => {
                navigate(getMorePath());
              },
            },
          ]}
        >
          <ActionIcon icon={MoreHorizontal} size="small" />
        </DropdownMenu>
      }
    >
      <ScrollShadowWithButton>{renderContent()}</ScrollShadowWithButton>
    </GroupBlock>
  );
});

export default CommunityRecommend;
