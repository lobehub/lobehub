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
    const prompt = chainUnderstandingPersona({
      diagnostics: { evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      providers: ['github'],
      responseLanguage: 'zh-CN',
    });

    expect(prompt).toContain('Pinned and merely listed repositories are weak');
    expect(prompt).toContain('Never use a pin by itself to claim ownership');
    expect(prompt).toContain('stars, forks, and contributor lists describe the repository');
    expect(prompt).toContain('Use the three GitHub repository lenses independently');
  });

  /** @example expect(prompt).toContain('OSS'); */
  it('carries composition into a grounded full-persona contract', () => {
    const prompt = chainUnderstandingDetailedPersona({ analysis, responseLanguage: 'zh-CN' });

    expect(prompt).toContain('OSS');
    expect(prompt).toContain('second-person Markdown');
    expect(prompt).toContain('zh-CN');
    expect(prompt).toContain('pinned or merely listed repositories do not establish ownership');
    expect(prompt).toContain('include smaller repositories when their contribution count');
    expect(prompt).toContain('deliberate curation, ecosystem impact, and current attention');
    expect(UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA.schema.required).toEqual([
      'tagline',
      'content',
      'reasoning',
    ]);
  });
});
