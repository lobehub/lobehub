import { describe, expect, it } from 'vitest';

import {
  createAgentSignalMemoryWriterPrompt,
  createAgentSignalMemoryWriterSystemRole,
} from './memoryWriter';

describe('agent signal memory writer prompt', () => {
  /**
   * @example
   * Memory writer explicitly receives memory language.
   */
  it('renders memory language in the system role', () => {
    expect(createAgentSignalMemoryWriterSystemRole({ memoryLanguage: 'zh-CN' })).toContain(
      'Write durable memory content in zh-CN.',
    );
  });

  /**
   * @example
   * User prompt keeps routing context inspectable.
   */
  it('renders the user memory prompt with routing context blocks', () => {
    expect(
      createAgentSignalMemoryWriterPrompt({
        evidence: [{ cue: 'going forward', excerpt: 'Going forward, use terse summaries.' }],
        feedbackHint: 'not_satisfied',
        memoryLanguage: 'English',
        message: 'Going forward, use terse summaries.',
        reason: 'durable preference',
      }),
    ).toMatchInlineSnapshot(`
      "User feedback to analyze for durable memory:
      Going forward, use terse summaries.

      Memory language: English

      Routing context:
      Feedback satisfaction hint: not_satisfied

      Domain routing reason: durable preference

      Domain evidence:
      [{"cue":"going forward","excerpt":"Going forward, use terse summaries."}]"
    `);
  });
});
