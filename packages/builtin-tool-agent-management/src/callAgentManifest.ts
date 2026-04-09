import type { InjectedToolManifest } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';
import { AgentManagementApiName, AgentManagementIdentifier } from './types';

const callAgentSystemRole = `You have a callAgent tool to delegate tasks to other AI agents.

<execution_guide>
### Synchronous Call (default)
callAgent(agentId, instruction) — agent responds directly in conversation.

### Asynchronous Task
callAgent(agentId, instruction, runAsTask: true, taskTitle: "...") — agent works in background.
Use runAsTask for complex/long operations that shouldn't block conversation.
</execution_guide>`;

/**
 * Create a slim manifest containing only the callAgent API.
 * Used when @mentioned agents need delegation without the full Agent Management toolset.
 */
export const createCallAgentManifest = (): InjectedToolManifest => {
  const callAgentApi = AgentManagementManifest.api.find(
    (api) => api.name === AgentManagementApiName.callAgent,
  );

  if (!callAgentApi) {
    throw new Error('callAgent API not found in AgentManagementManifest');
  }

  return {
    api: [
      {
        description: callAgentApi.description,
        name: callAgentApi.name,
        parameters: callAgentApi.parameters,
      },
    ],
    identifier: AgentManagementIdentifier,
    meta: { description: 'Delegate tasks to other agents', title: 'Agent Management' },
    systemRole: callAgentSystemRole,
    type: 'builtin',
  };
};
