import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { HeterogeneousTaskConfig } from './HeterogeneousTaskConfig';

const TaskModelConfig = memo(() => {
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskModel = useTaskStore(taskDetailSelectors.activeTaskModel);
  const taskProvider = useTaskStore(taskDetailSelectors.activeTaskProvider);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const updateTaskModelConfig = useTaskStore((s) => s.updateTaskModelConfig);

  // Fall back to the *assignee* agent's model, not whatever agent is active in
  // the surrounding chat (e.g. a Portal opened from an orchestrator). The detail
  // surface front-loads the assignee config (see `useActiveTaskDetail`), so this
  // resolves correctly. Only an unassigned task falls back to the active agent.
  const agentModel = useAgentStore((s) =>
    assigneeAgentId
      ? agentByIdSelectors.getAgentModelById(assigneeAgentId)(s)
      : agentSelectors.currentAgentModel(s),
  );
  const agentProvider = useAgentStore((s) =>
    assigneeAgentId
      ? agentByIdSelectors.getAgentModelProviderById(assigneeAgentId)(s)
      : agentSelectors.currentAgentModelProvider(s),
  );
  const heterogeneousProvider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(assigneeAgentId ?? '')(s)?.heterogeneousProvider,
    isEqual,
  );

  const runtimeConfig = useTaskStore(
    taskDetailSelectors.activeTaskRuntimeConfig(heterogeneousProvider),
    isEqual,
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

  // External runtimes previously hid this picker because ordinary provider models
  // do not describe their execution. Expose their runtime-aware configuration instead.
  if (runtimeConfig) {
    return <HeterogeneousTaskConfig fields={runtimeConfig} source={'task'} />;
  }

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
