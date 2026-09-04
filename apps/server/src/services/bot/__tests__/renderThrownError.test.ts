import { describe, expect, it } from 'vitest';

import { renderThrownAgentError } from '../renderThrownError';

// LOBE-13787: the bot's startup / catch-all failure paths posted a bare
// "**Agent Execution Failed**" — with no operation id, that carried no
// information at all. Classifying the thrown value first lets the tiered
// renderer pick curated copy, WITHOUT ever emitting the raw message.
describe('renderThrownAgentError', () => {
  it('gives a plain thrown Error the harness-tier copy instead of a bare header', () => {
    const out = renderThrownAgentError(new Error('Topic not found'), 'op-1');

    expect(out).toContain('Something went wrong on our side');
    expect(out).toContain('Operation ID: `op-1`');
    expect(out).not.toBe('**Agent Execution Failed**\nOperation ID: `op-1`');
  });

  // The case from the issue screenshot: the run died before it had an id, so
  // the old rendering was a bare header with literally nothing else.
  it('still says something useful when the run never got an operation id', () => {
    const out = renderThrownAgentError(new Error('gateway unreachable'), undefined);

    expect(out).not.toBe('**Agent Execution Failed**');
    expect(out).toContain('Something went wrong on our side');
    expect(out).not.toContain('Operation ID: `');
  });

  it('keeps the precise copy for a classified runtime payload', () => {
    const out = renderThrownAgentError(
      { errorType: 'NoAvailableProvider', message: 'no channel' },
      'op-2',
    );

    expect(out).toContain('No model provider configured');
    expect(out).toContain('op-2');
  });

  it('never leaks the raw error message into the reply', () => {
    const secret = 'connect ECONNREFUSED 10.0.0.7:5432';

    expect(renderThrownAgentError(new Error(secret), 'op-3')).not.toContain(secret);
    expect(renderThrownAgentError(secret, 'op-3')).not.toContain(secret);
  });

  it('renders localized copy', () => {
    const en = renderThrownAgentError(new Error('boom'), 'op-4');
    const zh = renderThrownAgentError(new Error('boom'), 'op-4', 'zh-CN');

    expect(zh).toContain('op-4');
    expect(zh).not.toContain('boom');
    expect(zh).not.toBe(en);
  });
});
