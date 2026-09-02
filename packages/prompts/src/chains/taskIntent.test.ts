import { describe, expect, it } from 'vitest';

import { chainTaskIntent, TASK_INTENT_JSON_SCHEMA, TASK_INTENT_PROMPT_VERSION } from './taskIntent';

describe('chainTaskIntent', () => {
  it('owns a dedicated version and a schema that always answers every field', () => {
    expect(TASK_INTENT_PROMPT_VERSION).toBe('v1');
    expect(TASK_INTENT_JSON_SCHEMA.name).toBe('task_intent');
    // `strict` output drops any field left out of `required`, and the composer
    // reads all of them to decide whether to interrupt the user.
    expect(TASK_INTENT_JSON_SCHEMA.schema.required).toEqual([
      'title',
      'summary',
      'refinedInstruction',
      'kind',
      'kindReason',
      'confidence',
      'clarifications',
    ]);
    expect(TASK_INTENT_JSON_SCHEMA.schema.properties.clarifications.maxItems).toBe(3);
  });

  it('tells the model that asking nothing is the expected outcome', () => {
    const system = chainTaskIntent({ instruction: 'Fix the typo in the README' }).messages[0]
      .content;

    expect(system).toContain('Zero questions is the expected outcome');
    expect(system).toContain('confidence "high" must come with an empty list');
    expect(system).toContain('materially different deliverables');
    expect(system).toContain('Never add scope');
    expect(system).toContain('When in doubt, "task"');
  });

  it('blocks the failure modes a real batch exposed', () => {
    const system = chainTaskIntent({ instruction: '优化一下首页' }).messages[0].content;

    // Silence on a request that names an intent but no deliverable: an early
    // draft of this prompt rated "优化一下首页" high-confidence with zero
    // questions and sent it straight to an agent.
    expect(system).toContain('a vague request is NOT an actionable one');
    expect(system).toContain('name the deliverable you would hand back');
    // Asking the user to make the executor's own build decisions.
    expect(system).toContain('it picks the how, the user owns the what');
    // A German title for an English draft; kindReason in English for a Chinese one.
    expect(system).toContain('A single field in another language is a defect');
  });

  it('passes the request through verbatim and appends context only when given', () => {
    const withContext = chainTaskIntent({
      context: 'Assigned agent: Docs Bot',
      instruction: 'Summarize https://example.com/spec into a table',
    });
    expect(withContext.messages[1].content).toContain('Summarize https://example.com/spec');
    expect(withContext.messages[1].content).toContain('## Context\nAssigned agent: Docs Bot');

    const withoutContext = chainTaskIntent({ instruction: 'Summarize the spec' });
    expect(withoutContext.messages[1].content).not.toContain('## Context');
  });
});
