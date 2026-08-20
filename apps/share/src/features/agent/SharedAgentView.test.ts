// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./SharedAgentView.tsx', import.meta.url), 'utf8');

describe('SharedAgentView client-only fallback', () => {
  it('keeps server-provided agent metadata visible while the visitor chunk loads', () => {
    expect(source).toContain('<ShareHero');
    expect(source).toContain('sharedAgentDisplayName(data.agentMeta)');
    expect(source).toContain('<SharedAgentBody data={data} fallback={hero} />');
  });
});
