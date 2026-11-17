import { describe, expect, it } from 'vitest';

import { AgentManagementManifest } from './manifest';
import { systemPrompt } from './systemRole';
import { AgentManagementApiName } from './types';

const apiNames = AgentManagementManifest.api.map((a) => a.name);

describe('AgentManagementManifest', () => {
  it('keeps the management APIs', () => {
    for (const name of [
      AgentManagementApiName.createAgent,
      AgentManagementApiName.updateAgent,
      AgentManagementApiName.deleteAgent,
      AgentManagementApiName.getAgentDetail,
      AgentManagementApiName.duplicateAgent,
      AgentManagementApiName.searchAgent,
      AgentManagementApiName.searchMarketTools,
      AgentManagementApiName.installPlugin,
      AgentManagementApiName.updatePrompt,
    ]) {
      expect(apiNames).toContain(name);
    }
  });
});

describe('systemPrompt', () => {
  it('keeps the management guidance intact', () => {
    for (const section of [
      'core_capabilities',
      'context_injection',
      'self_management',
      'agent_creation_guide',
      'search_guide',
      'workflow_patterns',
      'best_practices',
    ]) {
      expect(systemPrompt).toContain(`<${section}>`);
    }
  });
});
