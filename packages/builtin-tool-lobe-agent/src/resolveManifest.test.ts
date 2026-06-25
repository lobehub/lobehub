import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';
import { resolveLobeAgentManifest } from './resolveManifest';
import { LobeAgentApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveLobeAgentManifest', () => {
  it('returns the full static manifest in a normal (main, non-sub-agent) turn', () => {
    const result = resolveLobeAgentManifest({ scope: 'main' });

    // identical reference — no trimming, no clone
    expect(result).toBe(LobeAgentManifest);
    expect(apiNames(result!)).toContain(LobeAgentApiName.callSubAgent);
  });

  it('returns the full manifest when no context signals are set', () => {
    expect(resolveLobeAgentManifest({})).toBe(LobeAgentManifest);
  });

  it.each(['group', 'group_agent'])(
    'hides only callSubAgent (keeping plan/todo/visual) in scope %s',
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
      // non-api fields preserved
      expect(result.identifier).toBe(LobeAgentManifest.identifier);
      expect(result.systemRole).toBe(LobeAgentManifest.systemRole);
    },
  );

  it('hides callSubAgent inside a sub-agent run regardless of scope', () => {
    const result = resolveLobeAgentManifest({ isSubAgent: true, scope: 'main' })!;

    expect(apiNames(result)).not.toContain(LobeAgentApiName.callSubAgent);
    expect(apiNames(result)).toContain(LobeAgentApiName.createPlan);
  });

  it('does not mutate the original static manifest', () => {
    const before = LobeAgentManifest.api.length;
    resolveLobeAgentManifest({ scope: 'group' });
    expect(LobeAgentManifest.api).toHaveLength(before);
  });
});
