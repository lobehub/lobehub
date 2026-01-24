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
      return memory.memoryType === 'activity' && memory.withActivity?.type;
    });
  `,
};

const testCases: PromptfooTestCase[] = [
  {
    assert: [
      baseSchemaAssert,
      {
        type: 'javascript',
        value: `
          const data = JSON.parse(output);
          const target = data.memories?.find((memory) => {
            const text = [memory.title, memory.summary, memory.withActivity?.narrative]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return text.includes('support group');
          });

          if (!target) return false;
          const startsAt = target.withActivity?.startsAt;
          if (!startsAt) return false;

          return String(startsAt).startsWith('2023-05-07');
        `,
      },
      {
        provider: 'openai:gpt-5-mini',
        type: 'llm-rubric',
        value:
          'Should extract the LGBTQ support group activity from session_1 diaId D1:3, convert "yesterday" relative to the 2023-05-08 session anchor into 2023-05-07, and include a narrative about feeling supported/accepted.',
      },
    ],
    description: 'LoCoMo conv-26 session_1 resolves relative date',
    vars: {
      availableCategories: ['personal'],
      language: 'English',
      payloadPath: './promptfoo/evals/activity/locomo/tests/benchmark-locomo-payload-conv-26.json',
      sessionId: 'session_1',
      topK: 3,
      username: 'Caroline',
    },
  },
];

export default testCases;
