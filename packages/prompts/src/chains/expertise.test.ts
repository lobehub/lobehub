import { describe, expect, it } from 'vitest';

import {
  chainExpertiseDomainDraft,
  chainExpertiseTopicIngestion,
  EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA,
  EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION,
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
