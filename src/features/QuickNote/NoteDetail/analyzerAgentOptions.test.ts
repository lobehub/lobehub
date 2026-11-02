import { describe, expect, it } from 'vitest';

import { buildAnalyzerAgentOptions, BUILTIN_ANALYZER_VALUE } from './analyzerAgentOptions';

describe('buildAnalyzerAgentOptions', () => {
  // ROOT CAUSE:
  // The picker only listed the builtin analyzer. It now reads the shared sidebar agent list,
  // so the user's own agents are offered after the builtin default.
  it('lists the builtin analyzer first, then the user agents', () => {
    const options = buildAnalyzerAgentOptions(
      [
        { id: 'pinned', title: 'Researcher', type: 'agent' },
        { id: 'group', title: 'Team', type: 'group' },
        { id: 'private', title: '  ', type: 'agent' },
        { id: 'pinned', title: 'Researcher', type: 'agent' },
        { heterogeneousType: 'claude-code', id: 'cli', title: 'Claude Code', type: 'agent' },
      ],
      'Built-in analyzer',
    );

    expect(options).toEqual([
      { label: 'Built-in analyzer', value: BUILTIN_ANALYZER_VALUE },
      { label: 'Researcher', value: 'pinned' },
      { label: 'private', value: 'private' },
    ]);
  });

  it('keeps the builtin analyzer when the user has no agents', () => {
    expect(buildAnalyzerAgentOptions([], 'Built-in analyzer')).toEqual([
      { label: 'Built-in analyzer', value: BUILTIN_ANALYZER_VALUE },
    ]);
  });
});
