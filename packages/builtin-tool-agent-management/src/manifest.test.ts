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

describe('agent self-configuration', () => {
  /**
   * @example
   * The activator lists this tool by `meta.description`, so a model told
   * "你是我的文案助理" must be able to find it as the place to configure itself,
   * and the system role must send the role there instead of to user memory.
   */
  it('advertises self-configuration for role assignments', () => {
    expect(AgentManagementManifest.meta.description).toContain('your own system prompt');
    expect(systemPrompt).toContain('**Role assignments are self-configuration**');
    expect(systemPrompt).toContain('你是我的文案助理');
  });
});
