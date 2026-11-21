import { describe, expect, it } from 'vitest';

import { BOT_RETRO_JSON_SCHEMA, BOT_RETRO_PROMPT_VERSION, chainBotRetro } from '../botRetro';

const input = {
  agent: { description: 'Answers on Discord', title: 'Shadow' },
  date: '2026-11-01',
  lessons: ['Confirm the thread first'],
  topics: [
    {
      assistantMessageCount: 2,
      failedMessages: ['provider overloaded'],
      failedToolCalls: [{ apiName: 'search', errorSummary: '500', identifier: 'web-search' }],
      messageCount: 5,
      platform: 'discord',
      summary: 'deploy help',
      title: 'deploy thread',
      topicId: 'tpc-1',
    },
  ],
  vents: [
    {
      category: 'platform_bug',
      id: 'msg-vent',
      recorded: false,
      severity: 'high',
      summary: 'search 500s',
      topicId: 'tpc-1',
    },
  ],
  wakeMarks: [
    { label: 'missed_wake', outcome: 'skip', reason: 'was asked by name', topicId: null },
  ],
};

describe('chainBotRetro', () => {
  it('separates platform issues from own mistakes and treats owner marks as own mistakes', () => {
    const [system] = chainBotRetro(input).messages;

    expect(system.content).toContain('platformIssues');
    expect(system.content).toContain('selfMistakes');
    expect(system.content).toContain('Do not blame the platform for your own mistakes');
    expect(system.content).toContain('Each owner mark is your mistake');
    expect(system.content).toContain('15 or fewer');
  });

  it('hands the model the day: existing lessons, topics, vents with ids, and owner marks', () => {
    const user = chainBotRetro(input).messages[1].content as string;

    expect(user).toContain('You are Shadow — Answers on Discord. Day under review: 2026-11-01.');
    expect(user).toContain('- Confirm the thread first');
    expect(user).toContain('topicId tpc-1 · discord · deploy thread · 5 messages, 2 of them yours');
    expect(user).toContain('failed tool web-search/search: 500');
    expect(user).toContain('failed reply: provider overloaded');
    expect(user).toContain(
      'ventId msg-vent · platform_bug/high · rejected by the runtime as a repeat',
    );
    expect(user).toContain('- missed_wake (you stayed silent) · topicId -: was asked by name');
  });

  it('says so when a section is empty instead of leaving it blank', () => {
    const user = chainBotRetro({ ...input, lessons: [], vents: [], wakeMarks: [] }).messages[1]
      .content as string;

    expect(user).toContain('Your existing lessons:\n(none yet)');
    expect(user).toContain('Vents you filed today:\n(none)');
  });

  it('keeps the schema and prompt version aligned with the prompt fields', () => {
    expect(BOT_RETRO_PROMPT_VERSION).toBe('v1');
    expect(BOT_RETRO_JSON_SCHEMA.schema.required).toEqual([
      'lessons',
      'platformIssues',
      'selfMistakes',
      'summary',
    ]);
  });
});
