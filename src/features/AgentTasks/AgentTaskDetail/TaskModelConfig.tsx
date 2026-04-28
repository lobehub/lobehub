import { memo, useCallback } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskModelConfig = memo(() => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskModel = useTaskStore(taskDetailSelectors.activeTaskModel);
  const taskProvider = useTaskStore(taskDetailSelectors.activeTaskProvider);
  const updateTaskModelConfig = useTaskStore((s) => s.updateTaskModelConfig);

  const agentModel = useAgentStore(agentSelectors.currentAgentModel);
  const agentProvider = useAgentStore(agentSelectors.currentAgentModelProvider);

  const model = taskModel || agentModel || '';
  const provider = taskProvider || agentProvider || '';

  const handleChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!taskId) return;
      await updateTaskModelConfig(taskId, params);
    },
    [taskId, updateTaskModelConfig],
  );

  return (
    <ModelSelect
      initialWidth
      popupWidth={400}
      value={{ model, provider }}
      onChange={handleChange}
    />
  );
});

export default TaskModelConfig;
