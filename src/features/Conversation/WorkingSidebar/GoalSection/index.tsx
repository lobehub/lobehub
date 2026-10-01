import { memo } from 'react';

import GoalWorkflowCardContainer from './GoalWorkflowCard';
import { useTopicOperationGoals } from './useGoalSection';

/**
 * The conversation's Goals as workflow cards in the working sidebar — one card
 * per goal the topic created. A topic with several goals keeps only the newest
 * card open by default, so the panel leads with what just moved. Topics that
 * created no goal render nothing.
 */
const GoalSection = memo<{ className?: string }>(({ className }) => {
  const goals = useTopicOperationGoals();

  if (goals.length === 0) return null;

  return (
    <div className={className}>
      {goals.map((goal, index) => (
        <GoalWorkflowCardContainer
          criteriaCount={goal.criteriaCount}
          goalId={goal.goalId}
          initialCollapsed={index < goals.length - 1}
          key={goal.goalId}
          name={goal.name}
        />
      ))}
    </div>
  );
});

GoalSection.displayName = 'WorkingSidebarGoalSection';

export default GoalSection;
