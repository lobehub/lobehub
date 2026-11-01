import type { UnderstandingAnalysis } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  chainUnderstandingDetailedPersona,
  chainUnderstandingPersona,
  UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
} from './understanding';

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [{ description: 'Repeated work across repositories.', rank: 92, title: 'OSS' }],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: { content: 'Quick persona.', reasoning: 'Evidence.', tagline: 'Builder' },
  profile: {
    description: 'Profile description.',
    domains: ['Developer tools'],
    name: 'Test User',
    pronoun: 'non-specific',
    roles: ['Engineer'],
    summary: 'Profile summary.',
    tagline: 'Builder',
  },
};

describe('chainUnderstandingDetailedPersona', () => {
  /** @example A pinned repository alone cannot become an active role in quick Understanding. */
  it('keeps profile curation below contribution evidence in the quick analysis', () => {
    const { messages } = chainUnderstandingPersona({
      context: 'SOURCE_CONTEXT',
      diagnostics: { evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      providers: ['github'],
      responseLanguage: 'zh-CN',
    });

    expect(messages[0].content).toContain('Pinned and merely listed repositories are weak');
    expect(messages[0].content).toContain('Never use a pin by itself to claim ownership');
    expect(messages[0].content).toContain(
      'stars, forks, and contributor lists describe the repository',
    );
    expect(messages[0].content).toContain('Use the three GitHub repository lenses independently');
    expect(messages[1].content).toContain('SOURCE_CONTEXT');
  });

  /** @example expect(prompt).toContain('OSS'); */
  it('carries composition into a grounded full-persona contract', () => {
    const { messages } = chainUnderstandingDetailedPersona({
      analysis,
      context: 'SOURCE_CONTEXT',
      responseLanguage: 'zh-CN',
    });

    expect(messages[0].content).toContain('OSS');
    expect(messages[0].content).toContain('second-person Markdown');
    expect(messages[0].content).toContain('zh-CN');
    expect(messages[0].content).toContain(
      'pinned or merely listed repositories do not establish ownership',
    );
    expect(messages[0].content).toContain(
      'include smaller repositories when their contribution count',
    );
    expect(messages[0].content).toContain(
      'deliberate curation, ecosystem impact, and current attention',
    );
    expect(messages[1].content).toContain('SOURCE_CONTEXT');
    expect(UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA.schema.required).toEqual([
      'tagline',
      'content',
      'reasoning',
    ]);
  });
});
