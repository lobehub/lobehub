'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TaskTemplateCard } from '@/features/RecommendTaskTemplates/TaskTemplateCard';
import { TaskTemplateCardSkeleton } from '@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton';
import { useDailyBriefRecommendationsUI } from '@/features/RecommendTaskTemplates/useDailyBriefRecommendationsUI';

import LobeMessage from '../../components/LobeMessage';
import { styles } from '../AgentPickerStep/style';
import { useTaskKickoffActions } from './useTaskKickoffActions';

/**
 * Closing hand-off of the classic onboarding, shown after it is finished:
 * create a first task from a suggested template, or open a chat with an
 * opening prompt built from the user's interests. "Start a chat" and "Skip"
 * stay available whatever the suggestions do (loading, failed, empty).
 */
const TaskKickoffStep = memo(() => {
  const { t } = useTranslation('onboarding');
  const recommendations = useDailyBriefRecommendationsUI();
  const { canStartChat, handleCreated, handleSkip, handleStartChat } = useTaskKickoffActions({
    onRecommendationCreated:
      recommendations.mode === 'cards' ? recommendations.onCreated : undefined,
  });

  const renderSuggestions = () => {
    if (recommendations.mode === 'skeleton') {
      return Array.from({ length: recommendations.skeletonCount }, (_, index) => (
        <TaskTemplateCardSkeleton key={`task-kickoff-skeleton-${index}`} />
      ));
    }
    if (recommendations.mode === 'cards') {
      return recommendations.templates.map((tmpl) => (
        <TaskTemplateCard clickToCreate key={tmpl.id} template={tmpl} onCreated={handleCreated} />
      ));
    }
    return <div className={styles.empty}>{t('taskKickoff.empty')}</div>;
  };

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={[t('taskKickoff.title'), t('taskKickoff.title2')]} />
      <Text fontSize={14} type={'secondary'}>
        {t('taskKickoff.subtitle')}
      </Text>

      <Flexbox gap={8}>{renderSuggestions()}</Flexbox>

      <div className={styles.footer}>
        <span />
        <div className={styles.footerActions}>
          <Button type={'text'} onClick={handleSkip}>
            {t('taskKickoff.skip')}
          </Button>
          <Button loading={!canStartChat} type={'primary'} onClick={handleStartChat}>
            {t('taskKickoff.startChat')}
          </Button>
        </div>
      </div>
    </Flexbox>
  );
});

TaskKickoffStep.displayName = 'TaskKickoffStep';

export default TaskKickoffStep;
