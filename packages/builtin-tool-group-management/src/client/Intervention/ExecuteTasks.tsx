'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinInterventionProps } from '@lobechat/types';
import {
  Accordion,
  AccordionItem,
  Avatar,
  Flexbox,
  Icon,
  Tooltip,
  stopPropagation,
} from '@lobehub/ui';
import { Input, InputNumber } from 'antd';
import { createStaticStyles, useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Clock, Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams, TaskItem } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  assignee: css`
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
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
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  taskTitle: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  return (
    <AccordionItem
      defaultExpand
      itemKey={String(index)}
      paddingBlock={4}
      paddingInline={2}
      title={
        <Flexbox horizontal align={'center'} gap={8}>
          <div className={styles.assignee}>
            <Avatar
              avatar={agent?.avatar || DEFAULT_AVATAR}
              background={agent?.backgroundColor || theme.colorBgContainer}
              shape={'circle'}
              size={20}
            />
            <span>{agent?.title}</span>
          </div>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ marginTop: 8 }}>
        <Flexbox horizontal gap={12}>
          <Input
            placeholder={t('agentGroupManagement.executeTasks.intervention.titlePlaceholder')}
            size={'small'}
            value={task.title}
            variant={'filled'}
            onChange={handleTitleChange}
          />
          <Flexbox horizontal align={'center'} gap={8} onClick={stopPropagation}>
            <Tooltip title={t('agentGroupManagement.executeTask.intervention.timeout')}>
              <Clock size={14} />
            </Tooltip>
            <InputNumber
              className={styles.timeoutInput}
              max={120}
              min={1}
              size={'small'}
              suffix={t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
              value={Math.round((task.timeout || DEFAULT_TIMEOUT) / 60_000)}
              variant={'filled'}
              onChange={handleTimeoutChange}
            />
            <Icon
              className={styles.deleteButton}
              icon={Trash2}
              size={{ size: 16 }}
              onClick={handleDelete}
            />
          </Flexbox>
        </Flexbox>
        <Input.TextArea
          autoSize={{ maxRows: 20, minRows: 8 }}
          placeholder={t('agentGroupManagement.executeTasks.intervention.instructionPlaceholder')}
          value={task.instruction}
          variant={'filled'}
          onChange={handleInstructionChange}
        />
      </Flexbox>
    </AccordionItem>
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
      <Accordion className={styles.container} gap={0} variant={'borderless'}>
        {tasks.map((task, index) => (
          <TaskEditor
            index={index}
            key={task.agentId || index}
            task={task}
            onChange={handleTaskChange}
            onDelete={handleTaskDelete}
          />
        ))}
      </Accordion>
    );
  },
  isEqual,
);

ExecuteTasksIntervention.displayName = 'ExecuteTasksIntervention';

export default ExecuteTasksIntervention;
