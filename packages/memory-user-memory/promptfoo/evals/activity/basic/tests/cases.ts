type PromptfooAssert =
  | { type: 'javascript'; value: string }
  | { provider?: string; type: 'llm-rubric'; value: string };

interface PromptfooTestCase {
  assert: PromptfooAssert[];
  description?: string;
  vars: Record<string, unknown>;
}

const baseSchemaAssert: PromptfooAssert = {
  type: 'javascript',
  value: `
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      console.error('Failed to parse JSON output', error);
      return false;
    }

    if (!parsed || !Array.isArray(parsed.memories)) return false;

    return parsed.memories.every((memory) => {
      return (
        memory.memoryType === 'activity' &&
        memory.title &&
        memory.summary &&
        memory.withActivity?.type &&
        memory.withActivity?.narrative
      );
    });
  `,
};

const baseVars = {
  availableCategories: ['work', 'health', 'personal'],
  language: 'English',
  topK: 5,
  username: 'User',
};

const testCases: PromptfooTestCase[] = [
  {
    assert: [
      baseSchemaAssert,
      {
        type: 'javascript',
        value: `
          const data = JSON.parse(output);
          const first = data.memories?.[0];
          if (!first) return false;

          const activity = first.withActivity || {};
          return Boolean(activity.startsAt && activity.endsAt && activity.timezone && activity.associatedLocations?.[0]?.name);
        `,
      },
      {
        provider: 'openai:gpt-5-mini',
        type: 'llm-rubric',
        value:
          'Should extract a meeting activity including timing (start/end/timezone), location name ACME HQ, status completed when implied, and feedback reflecting the positive tone.',
      },
    ],
    description: 'Meeting with explicit time and location',
    vars: {
      ...baseVars,
      conversation:
        'User: I met with Alice at ACME HQ on 2024-05-03 from 14:00-15:00 America/New_York. We reviewed Q2 renewal scope and agreed to send revised pricing next week. I felt positive and collaborative about the call.',
      retrievedContexts: ['Previous similar memory: met with Alice about renewal last month.'],
      sessionDate: '2024-05-03',
    },
  },
  {
    assert: [
      baseSchemaAssert,
      {
        type: 'javascript',
        value: `
          const data = JSON.parse(output);
          const first = data.memories?.[0];
          if (!first) return false;

          const activity = first.withActivity || {};
          return Boolean(activity.narrative && activity.feedback);
        `,
      },
      {
        provider: 'openai:gpt-5-mini',
        type: 'llm-rubric',
        value:
          'Should capture an exercise activity without inventing exact timestamps or timezones; keep the narrative and feedback about the yoga session at home and omit temporal fields that were not provided.',
      },
    ],
    description: 'Exercise without explicit time or timezone',
    vars: {
      ...baseVars,
      conversation:
        'User: Over the weekend I did a 30-minute yoga session at home with my roommate. No specific time was set, it was just a casual stretch and it left me feeling calm.',
      retrievedContexts: [],
      sessionDate: '2025-05-05 10:02:00',
    },
  },
];

export default testCases;
