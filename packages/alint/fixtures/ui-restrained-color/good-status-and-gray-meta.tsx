// Fixture: color only for a real failure; metadata and types stay gray.
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { AlertCircle, ListTodo } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  error: css`
    color: ${cssVar.colorError};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface TaskRowProps {
  at: string;
  failed: boolean;
  failedLabel: string;
  title: string;
}

const TaskRow = memo<TaskRowProps>(({ at, failed, failedLabel, title }) => {
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon className={styles.meta} icon={ListTodo} />
      <span>{title}</span>
      <span className={styles.meta}>{at}</span>
      {failed && (
        <span className={styles.error}>
          <Icon icon={AlertCircle} /> {failedLabel}
        </span>
      )}
    </Flexbox>
  );
});

export default TaskRow;
