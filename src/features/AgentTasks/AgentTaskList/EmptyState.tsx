'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TaskTemplateCard } from '@/features/RecommendTaskTemplates/TaskTemplateCard';
import { TaskTemplateCardSkeleton } from '@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton';
import { useDailyBriefRecommendationsUI } from '@/features/RecommendTaskTemplates/useDailyBriefRecommendationsUI';
import WideScreenContainer from '@/features/WideScreenContainer';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const EMPTY_STATE_RECOMMEND_COUNT = 10;

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, 1fr)', [media.md]: '1fr' },
    gap: '12px',
  },
});

interface EmptyStateProps {
  /** When set, scopes task creation to this agent and locks the assignee. */
  agentId?: string;
  projectId?: string;
}

const EmptyState = memo<EmptyStateProps>(({ agentId, projectId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const templatesState = useDailyBriefRecommendationsUI({ count: EMPTY_STATE_RECOMMEND_COUNT });

  return (
    <WideScreenContainer
      fullWidth
      gap={32}
      paddingBlock={48}
      paddingInline={16}
      wrapperStyle={{ flex: 1, overflowY: 'auto' }}
    >
      <Flexbox align={'center'}>
        <Text as={'h1'} style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          {t('taskList.emptyHero.greeting')}
        </Text>
      </Flexbox>

      <CreateTaskInlineEntry
        agentId={agentId}
        lockAssignee={!!agentId}
        projectId={projectId}
        variant={'hero'}
      />

      {!projectId && templatesState.mode !== 'hidden' && (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Text fontSize={13} type={'secondary'} weight={500}>
              {t('taskList.emptyHero.templatesTitle')}
            </Text>
            {templatesState.mode === 'cards' && (
              <Flexbox
                horizontal
                align={'center'}
                gap={4}
                style={{ color: cssVar.colorTextDescription, cursor: 'pointer' }}
                onClick={templatesState.onRefresh}
              >
                <Icon icon={RefreshCw} size={12} />
                <Text fontSize={12}>{tCommon('taskTemplate.action.refresh.button')}</Text>
              </Flexbox>
            )}
          </Flexbox>
          <div {...stylex.props(styles.grid)}>
            {templatesState.mode === 'skeleton'
              ? Array.from({ length: templatesState.skeletonCount }).map((_, i) => (
                  <TaskTemplateCardSkeleton
                    descriptionRows={2}
                    key={`task-template-skeleton-${i}`}
                  />
                ))
              : templatesState.templates.map((tmpl) => (
                  <TaskTemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    onCreated={templatesState.onCreated}
                    onDismiss={templatesState.onDismiss}
                  />
                ))}
          </div>
        </Flexbox>
      )}
    </WideScreenContainer>
  );
});

EmptyState.displayName = 'AgentTasksEmptyState';

export default EmptyState;
