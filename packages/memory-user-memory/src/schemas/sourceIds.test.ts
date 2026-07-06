import { describe, expect, it } from 'vitest';

import { ContextMemoryItemSchema } from './context';
import { ExperienceMemoryItemSchema } from './experience';
import { AddIdentityActionSchema } from './identity';
import { PreferenceMemoryItemSchema } from './preference';

describe('memory item sourceIds schemas', () => {
  it('defaults missing top-level sourceIds to an empty array', () => {
    const context = ContextMemoryItemSchema.safeParse({
      details: 'Project details',
      memoryCategory: 'work',
      memoryType: 'context',
      summary: 'The user is working on a project.',
      tags: ['project'],
      title: 'Project context',
      withContext: {
        associatedObjects: [],
        associatedSubjects: [],
        currentStatus: 'ongoing',
        description: 'The project is in progress.',
        labels: ['project'],
        scoreImpact: 0.7,
        scoreUrgency: 0.5,
        title: 'Project',
        type: 'project',
      },
    });

    const experience = ExperienceMemoryItemSchema.safeParse({
      details: 'Debugging details',
      memoryCategory: 'work',
      memoryType: 'other',
      summary: 'The user learned a debugging approach.',
      tags: ['debugging'],
      title: 'Debugging approach',
      withExperience: {
        action: 'Traced the data flow.',
        keyLearning: 'Validate inputs at boundaries.',
        knowledgeValueScore: 0.8,
        labels: ['debugging'],
        possibleOutcome: 'Fewer production regressions.',
        problemSolvingScore: 0.9,
        reasoning: 'The error came from malformed tool args.',
        scoreConfidence: 0.8,
        situation: 'A production memory tool failed.',
        type: 'debugging',
      },
    });

    const preference = PreferenceMemoryItemSchema.safeParse({
      details: 'The user prefers concise answers.',
      memoryCategory: 'communication',
      memoryType: 'preference',
      summary: 'The user prefers concise answers.',
      tags: ['communication'],
      title: 'Concise answers',
      withPreference: {
        appContext: null,
        conclusionDirectives: 'Keep answers concise.',
        extractedLabels: ['concise'],
        extractedScopes: [],
        originContext: null,
        scorePriority: 0.7,
        suggestions: [],
        type: 'communication',
      },
    });

    expect(context.success && context.data.sourceIds).toEqual([]);
    expect(experience.success && experience.data.sourceIds).toEqual([]);
    expect(preference.success && preference.data.sourceIds).toEqual([]);
  });

  it('defaults missing identity sourceIds to an empty array', () => {
    const result = AddIdentityActionSchema.safeParse({
      details: null,
      memoryCategory: 'professional',
      memoryType: 'fact',
      summary: 'The user works as a platform engineer.',
      tags: ['work'],
      title: 'Platform engineer',
      withIdentity: {
        description: 'The user works as a platform engineer.',
        episodicDate: null,
        extractedLabels: ['platform-engineer'],
        relationship: 'self',
        role: 'platform engineer',
        scoreConfidence: 0.8,
        sourceEvidence: null,
        type: 'professional',
      },
    });

    expect(result.success && result.data.withIdentity.sourceIds).toEqual([]);
  });
});
