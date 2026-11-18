import { describe, expect, it } from 'vitest';

import { AgentBuilderManifest } from './manifest';
import { resolveAgentBuilderManifest } from './resolveManifest';
import { selfConfigurationSystemPrompt, systemPrompt } from './systemRole';
import { AgentBuilderApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveAgentBuilderManifest', () => {
  it('keeps the configuration-assistant manifest when the run edits another agent', () => {
    expect(resolveAgentBuilderManifest({ scope: 'agent_builder' })).toBe(AgentBuilderManifest);
    expect(resolveAgentBuilderManifest({ isSelfConfiguration: false })).toBe(AgentBuilderManifest);
    expect(AgentBuilderManifest.systemRole).toBe(systemPrompt);
  });

  it('addresses the agent about itself when the run edits its own configuration', () => {
    const result = resolveAgentBuilderManifest({ isSelfConfiguration: true })!;

    expect(result.identifier).toBe(AgentBuilderManifest.identifier);
    expect(result.systemRole).toBe(selfConfigurationSystemPrompt);
    // The assistant persona forbids acting as the configured agent; a self-configuring agent must
    // keep doing its own work.
    expect(result.systemRole).not.toContain('Agent Configuration Assistant');
    expect(apiNames(result)).toEqual([
      AgentBuilderApiName.getAvailableModels,
      AgentBuilderApiName.updateAgentConfig,
      AgentBuilderApiName.updatePrompt,
    ]);
    // The static manifest is not mutated.
    expect(apiNames(AgentBuilderManifest)).toContain(AgentBuilderApiName.installPlugin);
  });
});
