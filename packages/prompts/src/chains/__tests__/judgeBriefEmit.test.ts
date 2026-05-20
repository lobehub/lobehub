import { describe, expect, it } from 'vitest';

import { chainJudgeBriefEmit, JUDGE_BRIEF_EMIT_SCHEMA } from '../judgeBriefEmit';

describe('chainJudgeBriefEmit', () => {
  const baseParams = {
    artifacts: null,
    handoff: null,
    lastAssistantContent: 'Drafted the Q2 plan and pinned three documents.',
    taskInstruction: 'Plan Q2 priorities.',
    taskName: 'Q2 Planning',
  };

  it('asks only for an emit/skip verdict, not for title/summary copy', () => {
    const payload = chainJudgeBriefEmit(baseParams);
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toContain('decide whether the topic just completed is worth reporting');
    expect(system).toContain('Your only job here is the emit/skip judgment');
    expect(system).toMatch(/do NOT write them/i);
  });

  it('embeds the same task / handoff / artifacts context as the generation chain', () => {
    const payload = chainJudgeBriefEmit({
      ...baseParams,
      handoff: {
        keyFindings: ['Q1 missed targets'],
        nextAction: 'review with stakeholders',
        summary: 'Plan is ready for review.',
        title: 'Q2 plan ready',
      },
    });
    const user = (payload.messages?.[1] as { content: string }).content;

    expect(user).toContain('Q2 Planning');
    expect(user).toContain('Q2 plan ready');
    expect(user).toContain('Q1 missed targets');
    expect(user).toContain('review with stakeholders');
  });
});

describe('JUDGE_BRIEF_EMIT_SCHEMA', () => {
  it('schema requires emit + reason and forbids extra keys', () => {
    expect(JUDGE_BRIEF_EMIT_SCHEMA.required).toEqual(['emit', 'reason']);
    expect(JUDGE_BRIEF_EMIT_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(JUDGE_BRIEF_EMIT_SCHEMA.properties)).toEqual(['emit', 'reason']);
  });
});
