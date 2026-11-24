import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';
import {
  createLobeAgentDelegationManifest,
  LobeAgentDelegationManifest,
  resolveLobeAgentManifest,
} from './resolveManifest';
import { delegationSystemPrompt, systemPromptWithoutSubAgent } from './systemRole';
import { LobeAgentApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveLobeAgentManifest', () => {
  it('returns the full static manifest in a normal (main, non-sub-agent) turn', () => {
    const result = resolveLobeAgentManifest({ scope: 'main' });

    // identical reference — no trimming, no clone
    expect(result).toBe(LobeAgentManifest);
    expect(apiNames(result!)).toContain(LobeAgentApiName.callSubAgent);
    // full prompt still describes sub-agent dispatch
    expect(result!.systemRole).toContain('callSubAgent');
  });

  it('returns the full manifest when no context signals are set', () => {
    expect(resolveLobeAgentManifest({})).toBe(LobeAgentManifest);
  });

  it.each(['group', 'group_agent'])(
    'hides callSubAgent in both api and systemRole (keeping plan/todo/visual) in scope %s',
    (scope) => {
      const result = resolveLobeAgentManifest({ scope })!;

      const names = apiNames(result);
      expect(names).not.toContain(LobeAgentApiName.callSubAgent);
      expect(names).not.toContain(LobeAgentApiName.cancelSubAgent);
      // the rest of lobe-agent stays available
      expect(names).toContain(LobeAgentApiName.createPlan);
      expect(names).toContain(LobeAgentApiName.createTodos);
      expect(names).toContain(LobeAgentApiName.analyzeMedia);
      // exactly the two sub-agent APIs removed
      expect(names).toHaveLength(LobeAgentManifest.api.length - 2);

      // systemRole is rewritten so the prompt no longer mentions the hidden tool
      expect(result.systemRole).toBe(systemPromptWithoutSubAgent);
      expect(result.systemRole).not.toContain('callSubAgent');
      expect(result.systemRole).not.toContain('sub_agents');
      // plan/todo guidance survives in the rewritten prompt
      expect(result.systemRole).toContain('plan_and_todos');

      // non-api fields preserved
      expect(result.identifier).toBe(LobeAgentManifest.identifier);
    },
  );

  it('hides callSubAgent (api + systemRole) inside a sub-agent run regardless of scope', () => {
    const result = resolveLobeAgentManifest({ isSubAgent: true, scope: 'main' })!;

    expect(apiNames(result)).not.toContain(LobeAgentApiName.callSubAgent);
    expect(apiNames(result)).not.toContain(LobeAgentApiName.cancelSubAgent);
    expect(apiNames(result)).toContain(LobeAgentApiName.createPlan);
    expect(result.systemRole).not.toContain('callSubAgent');
    expect(result.systemRole).not.toContain('cancelSubAgent');
  });

  it('does not mutate the original static manifest', () => {
    const before = LobeAgentManifest.api.length;
    resolveLobeAgentManifest({ scope: 'group' });
    expect(LobeAgentManifest.api).toHaveLength(before);
    // the full manifest's systemRole still describes sub-agent dispatch
    expect(LobeAgentManifest.systemRole).toContain('callSubAgent');
  });

  it('offers callSubAgent with an optional agentId in the full manifest', () => {
    const api = LobeAgentManifest.api.find((a) => a.name === LobeAgentApiName.callSubAgent)!;

    expect(api.parameters.properties).toHaveProperty('agentId');
    expect(api.parameters.required).toEqual(['description', 'instruction']);
  });

  it('becomes the delegation-only manifest in chat mode', () => {
    const result = resolveLobeAgentManifest({ scope: 'main', toolMode: 'chat' })!;

    expect(result).toBe(LobeAgentDelegationManifest);
    expect(apiNames(result)).toEqual([LobeAgentApiName.callSubAgent]);
    expect(result.api[0].parameters.required).toEqual(['agentId', 'description', 'instruction']);
    expect(result.systemRole).toBe(delegationSystemPrompt);
    expect(result.systemRole).not.toContain('createPlan');
  });

  it('is unavailable in chat mode where dispatch is hidden', () => {
    expect(resolveLobeAgentManifest({ isSubAgent: true, toolMode: 'chat' })).toBeNull();
    expect(resolveLobeAgentManifest({ scope: 'group', toolMode: 'chat' })).toBeNull();
  });
});

describe('createLobeAgentDelegationManifest', () => {
  it('injects only callSubAgent under the lobe-agent identifier', () => {
    const manifest = createLobeAgentDelegationManifest();

    expect(manifest.identifier).toBe(LobeAgentManifest.identifier);
    expect(manifest.api.map((a) => a.name)).toEqual([LobeAgentApiName.callSubAgent]);
    expect(manifest.api[0].parameters.required).toContain('agentId');
    expect(manifest.systemRole).toBe(delegationSystemPrompt);
  });
});
