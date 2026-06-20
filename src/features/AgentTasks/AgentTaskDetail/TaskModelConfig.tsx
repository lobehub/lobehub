import { memo, useCallback } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskModelConfig = memo(() => {
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskModel = useTaskStore(taskDetailSelectors.activeTaskModel);
  const taskProvider = useTaskStore(taskDetailSelectors.activeTaskProvider);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const updateTaskModelConfig = useTaskStore((s) => s.updateTaskModelConfig);

  const agentModel = useAgentStore(agentSelectors.currentAgentModel);
  const agentProvider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const isHeterogeneous = useAgentStore(
    agentByIdSelectors.isAgentHeterogeneousById(assigneeAgentId ?? ''),
  );

  const model = taskModel || agentModel || '';
  const provider = taskProvider || agentProvider || '';

  const handleChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canEditTask) return;
      if (!taskId) return;
      await updateTaskModelConfig(taskId, params);
    },
    [canEditTask, taskId, updateTaskModelConfig],
  );

  // Heterogeneous agents (e.g. Claude Code) run on their own external runtime,
  // so the model is not user-selectable — hide the picker entirely.
  if (isHeterogeneous) return null;

  return (
    <ModelSelect
      initialWidth
      disabled={!canEditTask}
      popupWidth={400}
      value={{ model, provider }}
      onChange={handleChange}
    />
  );
});

export default TaskModelConfig;
