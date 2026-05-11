import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DailyBriefRecommendations } from '@/business/client/DailyBriefRecommendations';
import {
  type DailyBriefRecommendationsUIState,
  useDailyBriefRecommendationsUI,
} from '@/business/client/useDailyBriefRecommendationsUI';

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

const Recommendations = memo(() => {
  const { t } = useTranslation('home');
  const { t: tTaskTemplate } = useTranslation('taskTemplate');
  const taskTemplatesState = useDailyBriefRecommendationsUI();
  const { actions } = useEligibleActions();

  const showTaskTemplates = isTaskTemplatesVisible(taskTemplatesState);
  if (actions.length === 0 && !showTaskTemplates) return null;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text className={styles.subtitle} fontSize={12}>
          {t('recommendations.subtitle')}
        </Text>
        {taskTemplatesState.mode === 'cards' && (
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{ color: cssVar.colorTextDescription, cursor: 'pointer' }}
            onClick={taskTemplatesState.onRefresh}
          >
            <Icon icon={RefreshCw} size={12} />
            <Text fontSize={12}>{tTaskTemplate('action.refresh.button')}</Text>
          </Flexbox>
        )}
      </Flexbox>
      <Flexbox gap={8}>
        {actions.map((action) => (
          <RecommendationCard
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
        {showTaskTemplates ? <DailyBriefRecommendations state={taskTemplatesState} /> : null}
      </Flexbox>
    </Flexbox>
  );
});

Recommendations.displayName = 'Recommendations';

export default Recommendations;
