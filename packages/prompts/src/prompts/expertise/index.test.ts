import { describe, expect, it } from 'vitest';

import { EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT } from './index';

describe('EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT', () => {
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
