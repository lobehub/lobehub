import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sidebarRow } from '@/styles/density.stylex';

import GoalWorkflowCardContainer from './GoalWorkflowCard';
import { useTopicOperationGoals } from './useGoalSection';

/**
 * The conversation's Goals as workflow cards in the working sidebar — one card
 * per goal the topic created. A topic with several goals keeps only the newest
 * card open by default, so the panel leads with what just moved. Topics that
 * created no goal render nothing.
 */
const styles = stylex.create({
  cards: { display: 'flex', flexDirection: 'column', gap: sidebarRow.sectionGap },
});

const GoalSection = memo<{ className?: string }>(({ className }) => {
  const goals = useTopicOperationGoals();

  if (goals.length === 0) return null;

  return (
    <div className={className}>
      <div {...stylex.props(styles.cards)}>
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
    </div>
  );
});

GoalSection.displayName = 'WorkingSidebarGoalSection';

export default GoalSection;
