import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DailyBriefRecommendations } from '@/business/client/DailyBriefRecommendations';
import {
  type DailyBriefRecommendationsUIState,
  useDailyBriefRecommendationsUI,
} from '@/business/client/useDailyBriefRecommendationsUI';
import RailCard from '@/features/Home/components/RailCard';

import { useEligibleActions } from './hooks/useEligibleActions';
import { RecommendationCard } from './RecommendationCard';
import { spinHoldMs } from './spinHold';
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

  const [isRefreshing, setIsRefreshing] = useState(false);
  const startedAtRef = useRef(0);

  const canRefresh = taskTemplatesState.mode === 'cards';
  const onRefresh = canRefresh ? taskTemplatesState.onRefresh : undefined;
  // keepPreviousData keeps the previous cards mounted while the refreshed key
  // validates. The visible mode therefore cannot tell us that the request has
  // settled; use SWR's validating state from the hook.
  const isSettled =
    taskTemplatesState.mode !== 'skeleton' &&
    (taskTemplatesState.mode !== 'cards' || !taskTemplatesState.isValidating);

  useEffect(() => {
    if (!isRefreshing || !isSettled) return;

    const timer = setTimeout(
      () => setIsRefreshing(false),
      spinHoldMs(Date.now() - startedAtRef.current),
    );

    return () => clearTimeout(timer);
  }, [isRefreshing, isSettled]);

  const handleRefresh = useCallback(() => {
    if (isRefreshing || !onRefresh) return;

    startedAtRef.current = Date.now();
    setIsRefreshing(true);
    onRefresh();
  }, [isRefreshing, onRefresh]);

  const showTaskTemplates = isTaskTemplatesVisible(taskTemplatesState);
  if (actions.length === 0 && !showTaskTemplates) return null;

  // Rendered through the skeleton phase, not just in 'cards': the control that
  // started the refresh must not vanish while the refresh it started is running.
  const refresh = showTaskTemplates && (
    <Button
      disabled={!canRefresh && !isRefreshing}
      icon={<RefreshCw className={isRefreshing ? styles.refreshSpin : undefined} size={12} />}
      size={'small'}
      title={tCommon('taskTemplate.action.refresh.button')}
      type={'text'}
      onClick={handleRefresh}
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
