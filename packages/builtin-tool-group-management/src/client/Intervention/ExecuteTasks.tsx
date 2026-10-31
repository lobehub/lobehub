'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { AccordionHeader, AccordionItem, AccordionPanel, AccordionRoot, AccordionTrigger, Flexbox, Icon, Input, InputNumber, stopPropagation, TextArea, Tooltip, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import isEqual from 'fast-deep-equal';
import { Clock, Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams, TaskItem } from '../../types';

const styles = stylex.create({ assignee: { display: "flex", flexShrink: 0, gap: "6px", alignItems: "center", fontSize: "12px", color: cssVar.colorTextSecondary }, container: { paddingBlock: "12px", borderRadius: cssVar.borderRadius }, deleteButton: { cursor: "pointer", color: { default: cssVar.colorTextTertiary, ":hover": cssVar.colorError }, transition: "color 0.2s" }, index: { flexShrink: 0, fontSize: "12px", color: cssVar.colorTextQuaternary }, taskTitle: { overflow: "hidden", fontSize: "14px", fontWeight: 500, textOverflow: "ellipsis", whiteSpace: "nowrap" }, timeoutInput: { width: "100px" } });

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
    <AccordionRoot defaultValue={['task']} variant={'borderless'}>
      <AccordionItem value={'task'}>
        <AccordionHeader style={{ paddingBlock: 4, paddingInline: 2 }}>
          <AccordionTrigger>
            <Flexbox horizontal align={'center'} gap={8}>
              <div {...stylex.props(styles.assignee)}>
                <AgentAvatar
                  agentId={task.agentId}
                  avatar={agent?.avatar}
                  background={agent?.backgroundColor || theme.colorBgContainer}
                  name={agent?.title}
                  shape={'circle'}
                  size={20}
                />
                <span>{agent?.title}</span>
              </div>
            </Flexbox>
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionPanel>
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
                  className={stylex.props(styles.timeoutInput).className}
                  max={120}
                  min={1}
                  size={'small'}
                  suffix={t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
                  value={Math.round((task.timeout || DEFAULT_TIMEOUT) / 60_000)}
                  variant={'filled'}
                  onChange={handleTimeoutChange}
                />
                <Icon
                  className={stylex.props(styles.deleteButton).className}
                  icon={Trash2}
                  size={{ size: 16 }}
                  onClick={handleDelete}
                />
              </Flexbox>
            </Flexbox>
            <TextArea
              autoSize={{ maxRows: 20, minRows: 8 }}
              value={task.instruction}
              variant={'filled'}
              placeholder={t(
                'agentGroupManagement.executeTasks.intervention.instructionPlaceholder',
              )}
              onChange={handleInstructionChange}
            />
          </Flexbox>
        </AccordionPanel>
      </AccordionItem>
    </AccordionRoot>
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
      <Flexbox className={stylex.props(styles.container).className} gap={0}>
        {tasks.map((task, index) => (
          <TaskEditor
            index={index}
            key={task.agentId || index}
            task={task}
            onChange={handleTaskChange}
            onDelete={handleTaskDelete}
          />
        ))}
      </Flexbox>
    );
  },
  isEqual,
);

ExecuteTasksIntervention.displayName = 'ExecuteTasksIntervention';

export default ExecuteTasksIntervention;
