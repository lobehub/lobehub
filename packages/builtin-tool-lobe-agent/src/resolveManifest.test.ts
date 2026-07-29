import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';
import { resolveLobeAgentManifest } from './resolveManifest';
import { systemPromptWithoutSubAgent } from './systemRole';
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
      // the rest of lobe-agent stays available
      expect(names).toContain(LobeAgentApiName.createPlan);
      expect(names).toContain(LobeAgentApiName.createTodos);
      expect(names).toContain(LobeAgentApiName.analyzeVisualMedia);
      // exactly one API removed
      expect(names).toHaveLength(LobeAgentManifest.api.length - 1);

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
    expect(apiNames(result)).toContain(LobeAgentApiName.createPlan);
    expect(result.systemRole).not.toContain('callSubAgent');
  });

  it('does not mutate the original static manifest', () => {
    const before = LobeAgentManifest.api.length;
    resolveLobeAgentManifest({ scope: 'group' });
    expect(LobeAgentManifest.api).toHaveLength(before);
    // the full manifest's systemRole still describes sub-agent dispatch
    expect(LobeAgentManifest.systemRole).toContain('callSubAgent');
  });
});
