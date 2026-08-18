import { describe, expect, it } from 'vitest';

import {
  EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION,
  EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT,
  EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION,
  EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT,
} from './index';

describe('EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT', () => {
  it('uses a prompt-only semantic version colocated with the prompt', () => {
    expect(EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION).toBe('v3');
  });

  it("frames the draft as the Agent's own progressive expertise", () => {
    expect(EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT).toContain(
      'Speak as the agent whose expertise will evolve',
    );
    expect(EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT).toContain('do not refer to "the user"');
    expect(EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT).toContain('domain-native levels of abstraction');
    expect(EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT).toContain('generic seniority labels');
    expect(EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT).toContain(
      'what larger or more abstract unit can now be handled coherently?',
    );
  });
});

describe('EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT', () => {
  it('uses a prompt-only semantic version colocated with the prompt', () => {
    expect(EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION).toBe('v1');
  });

  it('filters conversations before extracting reusable lessons', () => {
    expect(EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT).toContain('domainFilter and outOfScope');
    expect(EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT).toContain('matches=false');
    expect(EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT).toContain('one-off fact');
  });
});
