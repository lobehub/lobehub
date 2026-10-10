import type { InjectedToolManifest } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';
import { AgentManagementApiName, AgentManagementIdentifier } from './types';

const callAgentSystemRole = `You have a callAgent tool to delegate tasks to other AI agents.

<execution_guide>
### Asynchronous by default
callAgent(agentId, instruction) returns immediately with a thread id — the called agent runs in the background; its result is written back to the call agent card when it completes. Check progress with \`lh thread view <threadId>\`.

### Blocking escape hatch
callAgent(agentId, instruction, wait: true) blocks the whole turn and returns the result inline — use only when the very next step strictly needs it.
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
