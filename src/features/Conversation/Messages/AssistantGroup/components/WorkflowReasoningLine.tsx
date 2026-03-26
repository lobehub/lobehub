import { type ModelReasoning } from '@lobechat/types';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { formatReasoningDuration } from '../toolDisplayNames';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    padding-block: 2px;
    padding-inline: 22px 8px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface WorkflowReasoningLineProps {
  reasoning: ModelReasoning;
}

const WorkflowReasoningLine = memo<WorkflowReasoningLineProps>(({ reasoning }) => {
  const duration = reasoning.duration ?? 0;
  if (duration === 0) return null;

  return <div className={styles.root}>Thought for {formatReasoningDuration(duration)}</div>;
});

WorkflowReasoningLine.displayName = 'WorkflowReasoningLine';

export default WorkflowReasoningLine;
