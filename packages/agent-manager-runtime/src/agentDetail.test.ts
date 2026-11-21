import { describe, expect, it } from 'vitest';

import { buildAgentDetailContent, describeHeterogeneousAgent } from './agentDetail';

describe('buildAgentDetailContent', () => {
  it('lists every promised config field for a native agent', () => {
    const content = buildAgentDetailContent({
      config: {
        model: 'gpt-4o',
        plugins: ['web-browsing', 'calculator (auto)'],
        provider: 'openai',
        systemRole: 'Be concise.',
      },
      meta: { description: 'Writes things', title: 'Writer' },
    });

    expect(content.split('\n')).toEqual([
      '**Writer**',
      'Writes things',
      'Model: gpt-4o',
      'Provider: openai',
      'Plugins: web-browsing, calculator (auto)',
      'System Prompt: Be concise.',
    ]);
  });

  // Regression guard (T-13805): empty fields used to be dropped, so a hetero
  // agent with no prompt/model/plugins rendered as just "**Title**".
  it('keeps empty fields as explicit placeholders and adds the hetero runtime', () => {
    const runtime = describeHeterogeneousAgent({
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'deepseek-harness' },
    });

    const content = buildAgentDetailContent({
      config: { model: null, plugins: [], provider: undefined, runtime, systemRole: '  ' },
      meta: { title: 'DeepSeek Harness' },
    });

    expect(content).not.toBe('**DeepSeek Harness**');
    expect(content).toContain('Model: (not set)');
    expect(content).toContain('Provider: (not set)');
    expect(content).toContain('Plugins: (none)');
    expect(content).toContain('System Prompt: (empty)');
    expect(content).toContain('Runtime: DeepSeek Harness');
    expect(content).toContain('Runs on: a server-spawned cloud sandbox');
  });
});
