import { describe, expect, it } from 'vitest';

import { classifyToolError } from '../errorClassification';

describe('classifyToolError', () => {
  it('should classify rate limit as retry', () => {
    const result = classifyToolError({ code: 'TOO_MANY_REQUESTS', message: 'rate limit' });

    expect(result.kind).toBe('retry');
  });

  it('should classify forbidden as stop', () => {
    const result = classifyToolError({ message: 'request failed 403 forbidden' });

    expect(result.kind).toBe('stop');
  });

  it('should classify invalid schema as replan', () => {
    const result = classifyToolError(new Error('invalid schema for tool arguments'));

    expect(result.kind).toBe('replan');
  });

  it('should default unknown errors to stop', () => {
    const result = classifyToolError(new Error('unexpected issue'));

    expect(result.kind).toBe('stop');
  });
});
