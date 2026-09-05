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

    expect(system).toContain('Fold every answer into the brief as a settled fact');
    expect(system).toContain('Never append a question-and-answer list');
    expect(system).toContain('missing, pending, or to be confirmed');
  });

  it('holds the rewrite to the request: nothing invented, nothing dropped', () => {
    const system = chainTaskInstruction({
      answers: [],
      instruction: 'Summarize https://example.com/spec',
    }).messages[0].content;

    expect(system).toContain('Preserve every URL, identifier, file path, number');
    expect(system).toContain('Completeness is about making the request fully actionable');
    expect(system).toContain('no invented deliverables, scope, quality bars, deadlines, or tools');
    // A skipped question is the user declining to narrow scope, not an
    // invitation to guess on their behalf.
    expect(system).toContain('A question the user skipped stays genuinely open');
  });

  it('asks for the whole working brief, not a one-line restatement', () => {
    // The executor reads this text and nothing else, so a single sentence
    // silently drops the inputs and constraints the answers established.
    const system = chainTaskInstruction({
      answers: [{ answer: 'Excel', question: 'Which format?' }],
      instruction: 'Compare last quarter by month',
    }).messages[0].content;

    expect(system).toContain('This brief is the whole handover');
    expect(system).toContain('not a one-line restatement of the request');
    expect(system).toContain('a complete brief in markdown');
    expect(system).toContain('an opening paragraph stating the outcome');
    // Completeness invites padding: an audience or business goal nobody stated
    // reads as a requirement to the executor.
    expect(system).toContain('Do not name an audience, a purpose or a business goal');
    expect(system).toContain('a requirements section under a markdown heading');
    // Open points are latitude, not a blocker that stalls the run.
    expect(system).toContain('in the wording of latitude rather than of a blocker');
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
