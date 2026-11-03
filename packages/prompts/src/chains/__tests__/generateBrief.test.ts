import { describe, expect, it } from 'vitest';

import { chainGenerateBrief, GENERATE_BRIEF_SCHEMA } from '../generateBrief';

describe('chainGenerateBrief', () => {
  const baseParams = {
    artifacts: null,
    handoff: null,
    lastAssistantContent: 'Drafted the Q2 plan and pinned three documents.',
    taskInstruction: 'Plan Q2 priorities.',
    taskName: 'Q2 Planning',
  };

  it('produces a payload that mandates non-empty title + summary, with no skip option', () => {
    const payload = chainGenerateBrief(baseParams);
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toContain('already been judged worth surfacing');
    expect(system).toContain('no skip option');
    expect(system).toContain('no emit vote');
    expect(system).toMatch(/non-empty title and summary/i);
  });

  it('embeds task name + instruction + assistant content in the user message', () => {
    const payload = chainGenerateBrief(baseParams);
    const user = (payload.messages?.[1] as { content: string }).content;

    expect(user).toContain('Q2 Planning');
    expect(user).toContain('Plan Q2 priorities.');
    expect(user).toContain('Drafted the Q2 plan and pinned three documents.');
  });

  it('renders an empty handoff and empty artifacts block when both are null', () => {
    const payload = chainGenerateBrief(baseParams);
    const user = (payload.messages?.[1] as { content: string }).content;

    expect(user).toContain('Handoff summary: (not available)');
    expect(user).toContain('Artifacts: (none)');
  });
});

describe('GENERATE_BRIEF_SCHEMA', () => {
  it('only requires title + summary — emit was moved to chainJudgeBriefEmit', () => {
    expect(GENERATE_BRIEF_SCHEMA.required).toEqual(['title', 'summary']);
    expect(Object.keys(GENERATE_BRIEF_SCHEMA.properties)).toEqual(['summary', 'title']);
    expect((GENERATE_BRIEF_SCHEMA.properties as any).emit).toBeUndefined();
  });
});
