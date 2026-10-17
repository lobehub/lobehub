import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import GoalAgentPill from './GoalAgentPill';
import { useGoalAgentModel } from './useGoalAgentModel';

interface GoalAgentModelConfigProps {
  /** Only the goal's owner may hand it over, the same rule as restart. */
  disabled?: boolean;
  goalId: string;
  /** The agent the page route is scoped to; see `useGoalAgentModel`. */
  routeAgentId?: string;
}

/**
 * Who plans the goal and who does its Tasks, each with the model it runs on
 * behind a settings button — like a Task's assignee and model.
 */
const GoalAgentModelConfig = ({ disabled, goalId, routeAgentId }: GoalAgentModelConfigProps) => {
  const { t } = useTranslation('chat');
  const { executor, planner } = useGoalAgentModel({ goalId, routeAgentId });

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
      <GoalAgentPill
        agentId={planner.agentId}
        disabled={disabled}
        label={t('goalDetail.mainAgentLabel')}
        placeholder={t('goalDetail.mainAgentUnassigned')}
        tooltip={t('goalDetail.mainAgent')}
        // An external runtime brings its own model, not a provider model.
        model={
          planner.agentId && !planner.heterogeneousType
            ? {
                lockedReason: planner.modelLocked ? t('goalDetail.modelFixed') : undefined,
                onChange: planner.changeModel,
                ready: planner.modelReady,
                title: t('goalDetail.planningModel'),
                value: planner.model,
              }
            : undefined
        }
        onChange={planner.changeAgent}
      />
      {/* Tasks go to the main agent until one is named, so there is no executor
          to pick before the goal has a main agent. */}
      {planner.agentId && (
        <GoalAgentPill
          agentId={executor.agentId}
          disabled={disabled}
          label={t('goalDetail.taskAgentLabel')}
          placeholder={t('goalDetail.taskAgentFollowsMain')}
          tooltip={t('goalDetail.taskAgent')}
          model={
            planner.agentId && !executor.heterogeneousType
              ? {
                  lockedReason: executor.modelLocked ? t('goalDetail.modelFixed') : undefined,
                  onChange: executor.changeModel,
                  ready: executor.modelReady,
                  title: t('goalDetail.taskModel'),
                  value: executor.model,
                }
              : undefined
          }
          onChange={executor.changeAgent}
        />
      )}
    </Flexbox>
  );
};

export default GoalAgentModelConfig;
