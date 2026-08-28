import { describe, expect, it } from 'vitest';

import { taskNameFromMessage } from '../taskName';

describe('taskNameFromMessage', () => {
  it('keeps a short single-line instruction verbatim', () => {
    expect(taskNameFromMessage('Triage my GitHub notifications')).toBe(
      'Triage my GitHub notifications',
    );
  });

  it('skips leading blank lines and uses the first line with content', () => {
    expect(taskNameFromMessage('\n\n  Draft the weekly digest\nthen publish it')).toBe(
      'Draft the weekly digest',
    );
  });

  it('collapses runs of whitespace inside the line', () => {
    expect(taskNameFromMessage('Check   the\tSEO   report')).toBe('Check the SEO report');
  });

  it('truncates an overlong line and marks the elision', () => {
    const name = taskNameFromMessage('a'.repeat(80));

    expect(name).toBe(`${'a'.repeat(60)}…`);
    expect(name).toHaveLength(61);
  });

  it('does not leave a dangling space before the ellipsis', () => {
    expect(taskNameFromMessage(`${'a'.repeat(60)} tail`)).toBe(`${'a'.repeat(60)}…`);
  });

  it('returns an empty name for a blank message', () => {
    expect(taskNameFromMessage('   \n  ')).toBe('');
  });
});
