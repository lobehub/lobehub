import { describe, expect, it } from 'vitest';

import { AgentManagementManifest } from './manifest';
import { resolveAgentManagementManifest } from './resolveManifest';
import { systemPrompt, systemPromptWithoutCallAgent } from './systemRole';
import { AgentManagementApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveAgentManagementManifest', () => {
  it('returns the full static manifest in a normal (non-sub-agent) turn', () => {
    const result = resolveAgentManagementManifest({ scope: 'main' });

    // identical reference — no trimming, no clone
    expect(result).toBe(AgentManagementManifest);
    expect(apiNames(result!)).toContain(AgentManagementApiName.callAgent);
    expect(result!.systemRole).toBe(systemPrompt);
  });

  it('returns the full manifest when no context signals are set', () => {
    expect(resolveAgentManagementManifest({})).toBe(AgentManagementManifest);
  });

  it('hides callAgent in both api and systemRole inside a sub-agent run', () => {
    const result = resolveAgentManagementManifest({ isSubAgent: true, scope: 'main' })!;

    const names = apiNames(result);
    expect(names).not.toContain(AgentManagementApiName.callAgent);
    // the rest of agent-management stays available
    expect(names).toContain(AgentManagementApiName.createAgent);
    expect(names).toContain(AgentManagementApiName.searchAgent);
    expect(names).toContain(AgentManagementApiName.getAgentDetail);
    // exactly one API removed
    expect(names).toHaveLength(AgentManagementManifest.api.length - 1);

    // systemRole is rewritten so the prompt no longer instructs the hidden tool
    expect(result.systemRole).toBe(systemPromptWithoutCallAgent);
    expect(result.systemRole).toContain('subagent_context');

    // non-api fields preserved
    expect(result.identifier).toBe(AgentManagementManifest.identifier);
  });
});

describe('systemPromptWithoutCallAgent', () => {
  it('never instructs the model to use callAgent', () => {
    // The only allowed mention is the sub-agent note explaining that the tool
    // does not exist in this context.
    const withoutNote = systemPromptWithoutCallAgent.replace(
      /<subagent_context>[\S\s]*?<\/subagent_context>/,
      '',
    );
    // Not just the API name — natural-language dispatch instructions
    // ("call the agent", "test with sample tasks") must go too, since testing
    // or calling an agent is exactly what a sub-agent cannot do.
    for (const phrase of [
      'callAgent',
      'Call agent',
      'Call the agent',
      'call it',
      'Calling Agents',
      'When calling agents',
      'Before calling an agent',
      'Test the agent',
      'Test with sample',
      'Test and Iterate',
      'execution_guide',
    ]) {
      expect(withoutNote).not.toContain(phrase);
    }
  });

  it('keeps the non-dispatch guidance intact', () => {
    for (const section of [
      'core_capabilities',
      'context_injection',
      'self_management',
      'agent_creation_guide',
      'search_guide',
      'workflow_patterns',
      'best_practices',
    ]) {
      expect(systemPromptWithoutCallAgent).toContain(`<${section}>`);
    }
  });
});
