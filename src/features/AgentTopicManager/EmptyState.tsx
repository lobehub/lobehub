'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

interface EmptyStateProps {
  agentId: string;
  hasFilters: boolean;
  onClearFilters: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ agentId, hasFilters, onClearFilters }) => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();

  return (
    <Flexbox align={'center'} flex={1} gap={16} justify={'center'} paddingBlock={64}>
      <Icon icon={MessagesSquare} size={48} style={{ color: cssVar.colorTextQuaternary }} />
      <Flexbox align={'center'} gap={4}>
        <Text fontSize={16} weight={600}>
          {hasFilters ? t('management.empty.filtered.title') : t('management.empty.noTopics.title')}
        </Text>
        <Text fontSize={13} type={'secondary'}>
          {hasFilters ? t('management.empty.filtered.desc') : t('management.empty.noTopics.desc')}
        </Text>
      </Flexbox>
      {hasFilters ? (
        <Button onClick={onClearFilters}>{t('management.empty.filtered.action')}</Button>
      ) : (
        <Button type={'primary'} onClick={() => navigate(AGENT_CHAT_URL(agentId))}>
          {t('management.empty.noTopics.action')}
        </Button>
      )}
    </Flexbox>
  );
});

EmptyState.displayName = 'AgentTopicManagerEmptyState';

export default EmptyState;
