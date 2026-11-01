import { describe, expect, it } from 'vitest';

import { buildCaseContent } from './caseEditorContent';

const draft = { category: '', environment: {}, input: ' Task ', turns: [] };

describe('case editor content patches', () => {
  it('explicitly clears previous inline overrides without clearing the shared environment binding', () => {
    const previous = { input: 'Task', environment: { timezone: 'America/Chicago' } };
    const content = buildCaseContent(draft);
    // updateTestCase merges the top-level JSONB keys, so omission would retain the old overrides.
    expect({ ...previous, ...content }).toMatchObject({ input: 'Task', environment: {} });
    expect(content).not.toHaveProperty('environmentId');
  });

  it('preserves nonempty overrides, expected output, and nonempty conversation turns', () => {
    const environment = { agent: { systemRole: 'Be concise' }, timezone: 'UTC' };
    expect(
      buildCaseContent({
        ...draft,
        category: ' Tools ',
        environment,
        expected: 'Expected answer',
        turns: [
          { content: 'Earlier request', role: 'user' },
          { content: ' ', role: 'assistant' },
        ],
      }),
    ).toEqual({
      category: 'Tools',
      environment,
      expected: 'Expected answer',
      input: 'Task',
      messages: [{ content: 'Earlier request', role: 'user' }],
    });
  });

  it('explicitly clears the category and all previous turns when the draft removes them', () => {
    expect(buildCaseContent(draft)).toMatchObject({ category: '', messages: [] });
  });
});
