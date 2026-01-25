const toolCallAssert = {
  type: 'javascript',
  value: `
    const calls = Array.isArray(output) ? output : [];
    if (calls.length === 0) return false;

    return calls.every((call) => {
      const fnName = call.function?.name || call.name;
      if (fnName !== 'commit_user_persona') return false;

      const rawArgs = call.function?.arguments ?? call.arguments;
      let args = {};
      if (typeof rawArgs === 'string') {
        try { args = JSON.parse(rawArgs); } catch { return false; }
      } else {
        args = rawArgs || {};
      }

      return typeof args.persona === 'string' && args.persona.trim().length > 10;
    });
  `,
};

const rubric = {
  provider: 'openai:gpt-5-mini',
  type: 'llm-rubric',
  value:
    'Should return a tool call to commit_user_persona with a meaningful second-person persona and concise diff/summary.',
};

export default [
  {
    assert: [{ type: 'is-valid-openai-tools-call' }, toolCallAssert, rubric],
    description: 'Generates a persona with baseline and events',
    vars: {
      existingPersona: '# About User\n- Loves TypeScript\n- Works on LobeHub',
      language: '简体中文',
      personaNotes: '- Keep concise',
      recentEvents: '- Shipped memory feature\n- Joined community call',
      retrievedMemories: '- Preference: dark mode\n- Context: building AI workspace',
      userProfile: '- Developer, open source contributor',
      username: 'User',
    },
  },
] as const;
