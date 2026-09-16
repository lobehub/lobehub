import { describe, expect, it } from 'vitest';

import {
  chainExpertiseDomainDraft,
  chainExpertiseRejectionIngestion,
  chainExpertiseTopicIngestion,
  EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA,
  EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION,
  EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA,
  EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA,
  EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION,
} from './expertise';

describe('chainExpertiseDomainDraft', () => {
  it('keeps the prompt contract, schema, and version together', () => {
    const result = chainExpertiseDomainDraft({ brief: '比喻写作' });

    expect(EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION).toBe('v3');
    expect(EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA.name).toBe('expertise_domain_draft');
    expect(result.messages[0].content).toContain('Speak as the agent whose expertise will evolve');
    expect(result.messages[0].content).toContain('do not refer to "the user"');
    expect(result.messages[0].content).toContain('domain-native levels of abstraction');
    expect(result.messages[0].content).toContain('generic seniority labels');
    expect(result.messages[0].content).toContain(
      'what larger or more abstract unit can now be handled coherently?',
    );
    expect(result.messages[1]).toEqual({ content: '比喻写作', role: 'user' });
  });

  it('builds a complete revision request from the editable draft', () => {
    const result = chainExpertiseDomainDraft({
      adjustment: '更聚焦修辞判断',
      brief: ' 比喻写作 ',
      currentDraft: { title: '旧标题' },
    });

    expect(result.messages[1].content).toContain('Original brief:\n比喻写作');
    expect(result.messages[1].content).toContain('Current editable draft:\n{"title":"旧标题"}');
    expect(result.messages[1].content).toContain('Requested adjustment:\n更聚焦修辞判断');
  });
});

describe('chainExpertiseTopicIngestion', () => {
  it('names the reference field so it cannot be read as "the existing code"', () => {
    const observation =
      EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA.schema.properties.domains.items.properties.observations
        .items;

    expect(Object.keys(observation.properties)).toContain('existingLessonCode');
    expect(Object.keys(observation.properties)).not.toContain('existingCode');
    expect(observation.required).toContain('existingLessonCode');
  });

  it('keeps filtering policy, input serialization, schema, and version together', () => {
    const result = chainExpertiseTopicIngestion({
      context: '[user] 帮我修改这段比喻',
      domains: [{ domainFilter: '比喻写作', id: 'domain-1' }],
    });

    expect(EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION).toBe('v2');
    expect(EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA.name).toBe('expertise_topic_ingestion');
    expect(result.messages[0].content).toContain('domainFilter and outOfScope');
    expect(result.messages[0].content).toContain('matches=false');
    expect(result.messages[0].content).toContain('one-off fact');
    expect(result.messages[0].content).toContain('Attaching to an existing lesson is the default');
    expect(result.messages[0].content).toContain(
      'existingLessonCode holds a lesson code and nothing else',
    );
    expect(result.messages[1].content).toContain('"id":"domain-1"');
    expect(result.messages[1].content).toContain('[user] 帮我修改这段比喻');
  });
});

describe('chainExpertiseRejectionIngestion', () => {
  it('declares no nullable unions, which the pinned model answers with `{}`', () => {
    // A live replay against gemini-3.6-flash returned `"existingLessonCode": {}` for every
    // `['string', 'null']` field under a strict json_schema, and the parse took the whole round
    // down with it. Empty string is the contract now; this test is the tripwire.
    const properties =
      EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA.schema.properties.domains.items.properties
        .observations.items.properties;

    for (const [name, definition] of Object.entries(properties)) {
      expect(`${name}:${JSON.stringify((definition as { type: unknown }).type)}`).not.toContain(
        'null',
      );
    }
  });

  it('attaches the circled frames and names what it withheld', () => {
    const result = chainExpertiseRejectionIngestion({
      domains: [{ domainFilter: '交付标准', id: 'domain-1' }],
      rejections: '[R1] promised: 讨论区\n  circled on frame 1 at 17%,35%: 这个顺序反了',
      visuals: [{ accessUrl: 'data:image/png;base64,AAAA', label: 'R1 (circled) — 讨论区' }],
      withheldEvidence: '2 further screenshot(s) from this round were not attached.',
    });

    const [system, user] = result.messages;
    expect(system.content).toContain('Most of these rejections are visual');
    expect(Array.isArray(user.content)).toBe(true);
    const blocks = user.content as { image_url?: { url: string }; text?: string; type: string }[];
    expect(blocks.filter((block) => block.type === 'image_url')).toHaveLength(1);
    expect(blocks[0].text).toContain('[frame 1] R1 (circled)');
    // Without this line the model reads a missing frame as proof that nothing was wrong there.
    expect(blocks[0].text).toContain('WITHHELD FROM THIS REQUEST');
  });

  it('falls back to a plain text message when no frame could be resolved', () => {
    const result = chainExpertiseRejectionIngestion({
      domains: [],
      rejections: '[R1] promised: 后端接口\n  said: 这个字段不对',
    });

    expect(typeof result.messages[1].content).toBe('string');
    expect(result.messages[1].content).toContain('(none)');
  });
});

describe('chainExpertiseRejectionIngestion reason provenance', () => {
  it('gives reasonSource a test the model can run, not a judgement call', () => {
    // Asking for "did the reviewer say why" produced 3 of 7 marked `reviewer` on rejections that
    // were pure instructions ("put it in one row", "there's an extra line here"). Naming the
    // observable — a stated consequence or cause — fixed all three, so the wording is the fix.
    const system = chainExpertiseRejectionIngestion({ domains: [], rejections: '' }).messages[0]
      .content as string;

    expect(system).toContain("does the reviewer's own text state a consequence or a cause");
    expect(system).toContain('When in doubt answer "inferred"');
    // The mechanism must still be written even when the reviewer only pointed — a reason-free
    // lesson cannot transfer to a screen nobody has built yet.
    expect(system).toContain('so write it even when the reviewer only pointed');
  });
});
