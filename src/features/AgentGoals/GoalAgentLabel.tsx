'use client';

import { createStaticStyles, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    flex: none;
    width: 140px;
    min-width: 0;
  `,
}));

interface GoalAgentLabelProps {
  agentId?: string | null;
}

/**
 * Whose goal a row is, on the cross-agent list. A fixed width keeps the
 * progress columns aligned row to row; a goal with no responsible agent (one
 * created from a project page) keeps the slot empty rather than inventing one.
 */
const GoalAgentLabel = memo<GoalAgentLabelProps>(({ agentId }) => {
  const meta = useAgentDisplayMeta(agentId);

  return (
    <Flexbox horizontal align={'center'} className={styles.label} gap={6}>
      {agentId && meta && (
        <>
          <AssigneeAvatar agentId={agentId} size={18} />
          <Text ellipsis fontSize={13} type={'secondary'}>
            {meta.title}
          </Text>
        </>
      )}
    </Flexbox>
  );
});

GoalAgentLabel.displayName = 'GoalAgentLabel';

export default GoalAgentLabel;
