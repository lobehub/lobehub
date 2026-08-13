import { memo, useCallback } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { taskDetailProjectionSelectors } from '@/projection/modules/task/derivedSelectors';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';
import { useActiveTaskDetailProjection, useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskModelConfig = memo(() => {
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskModel = useActiveTaskDetailProjection(taskDetailProjectionSelectors.activeTaskModel);
  const taskProvider = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskProvider,
  );
  const assigneeAgentId = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskAgentId,
  );
  const updateTaskModelConfig = useTaskStore((s) => s.updateTaskModelConfig);

  // Fall back to the *assignee* agent's model, not whatever agent is active in
  // the surrounding chat (e.g. a Portal opened from an orchestrator). The detail
  // surface front-loads the assignee config (see `useActiveTaskDetail`), so this
  // resolves correctly. Only an unassigned task falls back to the active agent.
  const activeAgentId = useAgentStore((state) => state.activeAgentId);
  const modelAgentId = assigneeAgentId ?? activeAgentId;
  const agentModel = useAgentValue(modelAgentId, agentProjectionSelectors.model);
  const agentProvider = useAgentValue(modelAgentId, agentProjectionSelectors.provider);
  const isHeterogeneous = useAgentValue(
    assigneeAgentId ?? '',
    agentProjectionSelectors.heterogeneous,
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
