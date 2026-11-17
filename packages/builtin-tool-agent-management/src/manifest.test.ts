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

  // installPlugin(source: 'market') needs an identifier the model can only get
  // from a marketplace search; without one it guessed ids.
  it('pairs market installPlugin with searchMarketTools', () => {
    expect(apiNames).toContain(AgentManagementApiName.searchMarketTools);
    expect(apiNames).toContain(AgentManagementApiName.installPlugin);
  });
});

describe('systemPrompt', () => {
  it('never instructs the model to dispatch agents itself', () => {
    expect(AgentManagementManifest.systemRole).toBe(systemPrompt);
    for (const phrase of [
      'callAgent(',
      '**callAgent**',
      'Call the agent',
      'Calling Agents',
      'When calling agents',
      'Before calling an agent',
      'Test the agent',
      'Test with sample',
      'execution_guide',
    ]) {
      expect(systemPrompt).not.toContain(phrase);
    }
  });

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
