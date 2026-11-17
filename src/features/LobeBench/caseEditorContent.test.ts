import type { EvalCaseEnvironment, ImportedMessage } from '@lobechat/types';
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

  it('preserves inline fields that the editor does not expose when saving other case fields', () => {
    const originalEnvironment: EvalCaseEnvironment = {
      agent: { memory: { enabled: true }, name: 'Assistant', plugins: [], systemRole: '' },
      envPrompt: 'Keep this context',
      memory: { persona: { narrative: 'Keep this fixture' } },
      toolForwarding: { calendar: { timeoutMs: 5000 } },
    };
    expect(buildCaseContent({ ...draft, originalEnvironment }).environment).toEqual(
      originalEnvironment,
    );
  });

  it('clears only editable overrides while retaining the other inline agent and Memory fields', () => {
    const preserved: EvalCaseEnvironment = {
      agent: { memory: { enabled: true }, title: 'Assistant' },
      memory: { persona: { narrative: 'Original fixture' } },
    };
    const originalEnvironment = {
      ...preserved,
      agent: { ...preserved.agent, plugins: ['calendar'], systemRole: 'Old role' },
      mock: { services: ['calendar'] },
      sessionDate: '2026-11-01T12:00:00Z',
      timezone: 'America/Chicago',
    };
    const before = structuredClone(originalEnvironment);
    expect(buildCaseContent({ ...draft, originalEnvironment }).environment).toEqual(preserved);
    expect(originalEnvironment).toEqual(before);
    expect(
      buildCaseContent({
        ...draft,
        originalEnvironment,
        environment: { agent: { systemRole: 'New role' }, timezone: 'UTC' },
      }).environment,
    ).toEqual({
      ...preserved,
      agent: { ...preserved.agent, systemRole: 'New role' },
      timezone: 'UTC',
    });
  });

  it.each([false, true])(
    'preserves unedited history including hidden roles and tool data (visible=%s)',
    (visible) => {
      const originalMessages: ImportedMessage[] = [
        { content: 'Prior system context', role: 'system' },
        ...(visible ? [{ content: 'Prior request', id: 'user-1', role: 'user' as const }] : []),
        { content: 'Tool result', role: 'tool', tool_call_id: 'call-1' },
      ];
      const turns = visible ? [{ content: 'Prior request', role: 'user' as const }] : [];
      expect(buildCaseContent({ ...draft, originalMessages, turns }).messages).toEqual(
        originalMessages,
      );
    },
  );

  it('clears the entire history when the user removes its visible turns', () => {
    const originalMessages: ImportedMessage[] = [
      { content: 'Previous request', role: 'user' },
      { content: 'Tool result', role: 'tool', tool_call_id: 'call-1' },
    ];
    expect(buildCaseContent({ ...draft, originalMessages }).messages).toEqual([]);
  });
});
