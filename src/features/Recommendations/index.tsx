import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DailyBriefRecommendations } from '@/business/client/DailyBriefRecommendations';
import {
  type DailyBriefRecommendationsUIState,
  useDailyBriefRecommendationsUI,
} from '@/business/client/useDailyBriefRecommendationsUI';
import RailCard from '@/routes/(main)/home/features/components/RailCard';

import { useEligibleActions } from './hooks/useEligibleActions';
import { RecommendationCard } from './RecommendationCard';
import { styles } from './style';

const isTaskTemplatesVisible = (state: DailyBriefRecommendationsUIState): boolean =>
  state.mode !== 'hidden';

export const useRecommendationsVisible = (): boolean => {
  const taskTemplatesState = useDailyBriefRecommendationsUI();
  const { actions } = useEligibleActions();
  return actions.length > 0 || isTaskTemplatesVisible(taskTemplatesState);
};

interface RecommendationsProps {
  variant?: 'default' | 'rail';
}

const Recommendations = memo<RecommendationsProps>(({ variant = 'default' }) => {
  const { t } = useTranslation('home');
  const { t: tCommon } = useTranslation('common');
  const taskTemplatesState = useDailyBriefRecommendationsUI();
  const { actions } = useEligibleActions();

  const showTaskTemplates = isTaskTemplatesVisible(taskTemplatesState);
  if (actions.length === 0 && !showTaskTemplates) return null;

  const refresh = taskTemplatesState.mode === 'cards' && (
    <Button
      icon={<RefreshCw size={12} />}
      size={'small'}
      title={tCommon('taskTemplate.action.refresh.button')}
      type={'text'}
      onClick={taskTemplatesState.onRefresh}
    />
  );

  const compact = variant === 'rail';

  const body = (
    <Flexbox gap={compact ? 2 : 8}>
      {actions.map((action) => (
        <RecommendationCard
          compact={compact}
          ctaKey={action.ctaKey}
          descriptionKey={action.descriptionKey}
          i18nValues={action.i18nValues}
          icon={action.icon}
          key={action.id}
          tagKey={action.tagKey}
          titleKey={action.titleKey}
          onAction={action.run}
        />
      ))}
      {showTaskTemplates ? (
        <DailyBriefRecommendations compact={compact} state={taskTemplatesState} />
      ) : null}
    </Flexbox>
  );

  if (variant === 'rail')
    return (
      <RailCard action={refresh} title={t('recommendations.title')}>
        {body}
      </RailCard>
    );

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text className={styles.subtitle} fontSize={12}>
          {t('recommendations.subtitle')}
        </Text>
        {taskTemplatesState.mode === 'cards' && (
          <Button
            icon={<RefreshCw size={12} />}
            size={'small'}
            type={'text'}
            onClick={taskTemplatesState.onRefresh}
          >
            {tCommon('taskTemplate.action.refresh.button')}
          </Button>
        )}
      </Flexbox>
      {body}
    </Flexbox>
  );
});

Recommendations.displayName = 'Recommendations';

export default Recommendations;
