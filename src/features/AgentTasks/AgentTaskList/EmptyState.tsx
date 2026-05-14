'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TaskTemplateCard } from '@/features/RecommendTaskTemplates/TaskTemplateCard';
import { TaskTemplateCardSkeleton } from '@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton';
import { useDailyBriefRecommendationsUI } from '@/features/RecommendTaskTemplates/useDailyBriefRecommendationsUI';
import WideScreenContainer from '@/features/WideScreenContainer';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const HERO_MAX_WIDTH = 720;
const EMPTY_STATE_RECOMMEND_COUNT = 10;

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    ${responsive.md} {
      grid-template-columns: 1fr;
    }
  `,
}));

const EmptyState = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tTaskTemplate } = useTranslation('taskTemplate');
  const templatesState = useDailyBriefRecommendationsUI({ count: EMPTY_STATE_RECOMMEND_COUNT });

  return (
    <WideScreenContainer
      gap={32}
      minWidth={HERO_MAX_WIDTH}
      paddingBlock={48}
      wrapperStyle={{ flex: 1, overflowY: 'auto' }}
    >
      <Flexbox align={'center'} gap={8}>
        <Text as={'h1'} style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          {t('taskList.emptyHero.greeting')}
        </Text>
        <Text fontSize={14} type={'secondary'}>
          {t('taskList.emptyHero.subtitle')}
        </Text>
      </Flexbox>

      <CreateTaskInlineEntry variant={'hero'} />

      {templatesState.mode !== 'hidden' && (
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
                <Text fontSize={12}>{tTaskTemplate('action.refresh.button')}</Text>
              </Flexbox>
            )}
          </Flexbox>
          <div className={styles.grid}>
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
