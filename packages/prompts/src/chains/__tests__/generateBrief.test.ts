import { describe, expect, it } from 'vitest';

import { chainGenerateBrief } from '../generateBrief';

describe('chainGenerateBrief', () => {
  const baseParams = {
    artifacts: null,
    handoff: null,
    lastAssistantContent: 'Drafted the Q2 plan and pinned three documents.',
    taskInstruction: 'Plan Q2 priorities.',
    taskName: 'Q2 Planning',
  };

  it('default mode keeps the skip branch in the prompt', () => {
    const payload = chainGenerateBrief(baseParams);
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toContain('decide whether the topic just completed is worth reporting');
    expect(system).toContain('emit=false');
    expect(system).not.toContain('scheduled-task tick');
  });

  it('forceEmit swaps in the scheduled-tick prompt', () => {
    const payload = chainGenerateBrief({ ...baseParams, forceEmit: true });
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toContain('scheduled-task tick');
    expect(system).toContain('there is NO skip option');
    expect(system).toContain('ALWAYS true');
    expect(system).not.toMatch(/return false under any circumstance[\s\S]*emit=false/);
  });

  it('forceEmit prompt covers the no-activity path explicitly', () => {
    const payload = chainGenerateBrief({ ...baseParams, forceEmit: true });
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toContain('no new tickets today');
    expect(system).toContain('do not invent activity that did not occur');
  });

  it('user message is unchanged across modes', () => {
    const auto = chainGenerateBrief(baseParams);
    const forced = chainGenerateBrief({ ...baseParams, forceEmit: true });

    expect(auto.messages?.[1]).toEqual(forced.messages?.[1]);
  });
});
