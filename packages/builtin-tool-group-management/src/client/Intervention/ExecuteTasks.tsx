'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Collapse, Input, InputNumber } from 'antd';
import { createStaticStyles, useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Clock, Trash2 } from 'lucide-react';
import { ChangeEvent, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams, TaskItem } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentTitle: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  container: css`
    padding-block: 12px;
    border-radius: ${cssVar.borderRadius};
  `,
  deleteButton: css`
    cursor: pointer;
    color: ${cssVar.colorTextTertiary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorError};
    }
  `,
  taskCard: css`
    .ant-collapse-header {
      padding-block: 8px !important;
      padding-inline: 12px !important;
    }

    .ant-collapse-content-box {
      padding: 12px !important;
    }
  `,
  taskTitle: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  timeoutInput: css`
    width: 100px;
  `,
}));

const DEFAULT_TIMEOUT = 1_800_000; // 30 minutes

interface TaskEditorProps {
  index: number;
  onChange: (index: number, updates: Partial<TaskItem>) => void;
  onDelete: (index: number) => void;
  task: TaskItem;
}

const TaskEditor = memo<TaskEditorProps>(({ task, index, onChange, onDelete }) => {
  const { t } = useTranslation('tool');
  const theme = useTheme();

  // Get agent info from store
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const agent = useAgentGroupStore((s) =>
    task.agentId && activeGroupId
      ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, task.agentId)(s)
      : undefined,
  );

  const handleTitleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(index, { title: e.target.value });
    },
    [index, onChange],
  );

  const handleInstructionChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(index, { instruction: e.target.value });
    },
    [index, onChange],
  );

  const handleTimeoutChange = useCallback(
    (value: number | null) => {
      if (value !== null) {
        onChange(index, { timeout: value * 60 * 1000 });
      }
    },
    [index, onChange],
  );

  const handleDelete = useCallback(() => {
    onDelete(index);
  }, [index, onDelete]);

  const header = (
    <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
      <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ minWidth: 0 }}>
        <Avatar
          avatar={agent?.avatar || DEFAULT_AVATAR}
          background={agent?.backgroundColor || theme.colorBgContainer}
          shape={'square'}
          size={24}
        />
        <span className={styles.taskTitle}>{task.title || agent?.title || 'Task'}</span>
      </Flexbox>
      <Flexbox align={'center'} gap={8} horizontal onClick={(e) => e.stopPropagation()}>
        <Tooltip title={t('agentGroupManagement.executeTask.intervention.timeout')}>
          <Clock size={14} />
        </Tooltip>
        <InputNumber
          className={styles.timeoutInput}
          max={120}
          min={1}
          onChange={handleTimeoutChange}
          size={'small'}
          suffix={t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
          value={Math.round((task.timeout || DEFAULT_TIMEOUT) / 60_000)}
          variant={'filled'}
        />
        <Icon
          className={styles.deleteButton}
          icon={Trash2}
          onClick={handleDelete}
          size={{ size: 16 }}
        />
      </Flexbox>
    </Flexbox>
  );

  return (
    <Collapse
      className={styles.taskCard}
      defaultActiveKey={[index]}
      items={[
        {
          children: (
            <Flexbox gap={12}>
              <Input
                onChange={handleTitleChange}
                placeholder={t('agentGroupManagement.executeTasks.intervention.titlePlaceholder')}
                value={task.title}
              />
              <Input.TextArea
                autoSize={{ maxRows: 8, minRows: 4 }}
                onChange={handleInstructionChange}
                placeholder={t(
                  'agentGroupManagement.executeTasks.intervention.instructionPlaceholder',
                )}
                value={task.instruction}
              />
            </Flexbox>
          ),
          key: index,
          label: header,
        },
      ]}
    />
  );
});

/**
 * ExecuteTasks Intervention Component
 *
 * Allows users to review and modify multiple tasks before execution.
 */
const ExecuteTasksIntervention = memo<BuiltinInterventionProps<ExecuteTasksParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    // Local state
    const [tasks, setTasks] = useState<TaskItem[]>(args?.tasks || []);
    const [hasChanges, setHasChanges] = useState(false);

    // Sync local state when args change externally
    useEffect(() => {
      if (!hasChanges) {
        setTasks(args?.tasks || []);
      }
    }, [args?.tasks, hasChanges]);

    // Handle task change
    const handleTaskChange = useCallback((index: number, updates: Partial<TaskItem>) => {
      setTasks((prev) => {
        const newTasks = [...prev];
        newTasks[index] = { ...newTasks[index], ...updates };
        return newTasks;
      });
      setHasChanges(true);
    }, []);

    // Handle task delete
    const handleTaskDelete = useCallback((index: number) => {
      setTasks((prev) => prev.filter((_, i) => i !== index));
      setHasChanges(true);
    }, []);

    // Save changes before approval
    useEffect(() => {
      if (!registerBeforeApprove) return;

      const cleanup = registerBeforeApprove('executeTasks', async () => {
        if (hasChanges && onArgsChange) {
          await onArgsChange({ ...args, tasks });
        }
      });

      return cleanup;
    }, [registerBeforeApprove, hasChanges, tasks, args, onArgsChange]);

    return (
      <Flexbox className={styles.container} gap={12}>
        {tasks.map((task, index) => (
          <TaskEditor
            index={index}
            key={task.agentId || index}
            onChange={handleTaskChange}
            onDelete={handleTaskDelete}
            task={task}
          />
        ))}
      </Flexbox>
    );
  },
  isEqual,
);

ExecuteTasksIntervention.displayName = 'ExecuteTasksIntervention';

export default ExecuteTasksIntervention;
