import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';

interface WorkflowSummaryProps {
  duration?: string;
  expanded?: boolean;
  hasError: boolean;
  onToggle: () => void;
  streaming?: boolean;
  summaryText: string;
}

const styles = createStaticStyles(({ css }) => ({
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
    transition: transform 100ms ${cssVar.motionEaseOut};
  `,
  dot: css`
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  duration: css`
    flex-shrink: 0;
    margin-inline-start: auto;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  root: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.12s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  text: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const WorkflowSummary = memo<WorkflowSummaryProps>(
  ({ summaryText, hasError, onToggle, expanded, streaming, duration }) => {
    const dotColor = streaming
      ? cssVar.colorInfo
      : hasError
        ? cssVar.colorWarning
        : cssVar.colorTextQuaternary;

    return (
      <div className={styles.root} onClick={onToggle}>
        <span
          className={styles.dot}
          style={{
            animation: streaming ? 'workflow-pulse 1.5s infinite' : undefined,
            background: dotColor,
          }}
        />
        <span className={styles.text}>{streaming ? 'Working...' : summaryText}</span>
        {!streaming && duration && <span className={styles.duration}>{duration}</span>}
        {!streaming && (
          <span
            className={styles.chevron}
            style={{ transform: expanded ? undefined : 'rotate(-90deg)' }}
          >
            <ChevronDown size={12} />
          </span>
        )}
      </div>
    );
  },
);

WorkflowSummary.displayName = 'WorkflowSummary';

export default WorkflowSummary;
