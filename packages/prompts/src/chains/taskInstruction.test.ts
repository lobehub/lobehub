import { describe, expect, it } from 'vitest';

import {
  chainTaskInstruction,
  TASK_INSTRUCTION_JSON_SCHEMA,
  TASK_INSTRUCTION_PROMPT_VERSION,
} from './taskInstruction';

describe('chainTaskInstruction', () => {
  it('owns a dedicated version and a schema that always answers both fields', () => {
    expect(TASK_INSTRUCTION_PROMPT_VERSION).toBe('v1');
    expect(TASK_INSTRUCTION_JSON_SCHEMA.name).toBe('task_instruction');
    expect(TASK_INSTRUCTION_JSON_SCHEMA.schema.required).toEqual(['instruction', 'title']);
  });

  it('forbids the appendix that made the first pass contradict itself', () => {
    const system = chainTaskInstruction({
      answers: [{ answer: 'PDF', question: 'Which format?' }],
      instruction: 'Compare last quarter by month',
    }).messages[0].content;

    expect(system).toContain('Fold every answer into the body as a settled fact');
    expect(system).toContain('Never append a question-and-answer list');
    expect(system).toContain('missing, pending, or to be confirmed');
  });

  it('holds the rewrite to the request: nothing invented, nothing dropped', () => {
    const system = chainTaskInstruction({
      answers: [],
      instruction: 'Summarize https://example.com/spec',
    }).messages[0].content;

    expect(system).toContain('Preserve every URL, identifier, file path, number');
    expect(system).toContain('Add nothing the user did not ask for');
    // A skipped question is the user declining to narrow scope, not an
    // invitation to guess on their behalf.
    expect(system).toContain('A question the user skipped stays genuinely open');
  });

  it('passes the answers through as pairs, and omits the block when there are none', () => {
    const withAnswers = chainTaskInstruction({
      answers: [{ answer: 'PDF', question: 'Which format?' }],
      context: 'Assigned agent: Docs Bot',
      instruction: 'Compare last quarter by month',
    });
    expect(withAnswers.messages[1].content).toContain('- Which format? → PDF');
    expect(withAnswers.messages[1].content).toContain('## Context\nAssigned agent: Docs Bot');

    const none = chainTaskInstruction({ answers: [], instruction: 'Compare last quarter' });
    expect(none.messages[1].content).not.toContain('## Answers');
  });
});
