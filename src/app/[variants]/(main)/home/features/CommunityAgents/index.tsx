'use client';

import { ActionIcon, Dropdown } from '@lobehub/ui';
import { BotIcon, MoreHorizontal } from 'lucide-react';
import { Suspense, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import GroupBlock from '../components/GroupBlock';
import GroupSkeleton from '../components/GroupSkeleton';
import ScrollShadowWithButton from '../components/ScrollShadowWithButton';
import { RECENT_BLOCK_SIZE } from '../const';
import CommunityAgentsList from './List';

const CommunityAgents = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  return (
    <GroupBlock
      action={
        <Dropdown
          menu={{
            items: [
              {
                key: 'all-assistants',
                label: t('home.more'),
                onClick: () => {
                  navigate('/community/assistant');
                },
              },
            ],
          }}
        >
          <ActionIcon icon={MoreHorizontal} size="small" />
        </Dropdown>
      }
      icon={BotIcon}
      title={t('home.communityAgents')}
    >
      <ScrollShadowWithButton>
        <Suspense
          fallback={
            <GroupSkeleton
              height={RECENT_BLOCK_SIZE.AGENT.HEIGHT}
              width={RECENT_BLOCK_SIZE.AGENT.WIDTH}
            />
          }
        >
          <CommunityAgentsList />
        </Suspense>
      </ScrollShadowWithButton>
    </GroupBlock>
  );
});

export default CommunityAgents;
