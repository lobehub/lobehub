import { describe, expect, it } from 'vitest';

import { matchJsonSchema } from '../jsonSchema';

const schema = {
  properties: { age: { type: 'number' }, name: { type: 'string' } },
  required: ['name'],
  type: 'object',
};

describe('matchJsonSchema', () => {
  it('should pass when JSON matches schema', () => {
    const result = matchJsonSchema('{"name":"Alice","age":30}', { schema } as any);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('should fail when JSON does not match schema', () => {
    const result = matchJsonSchema('{"age":"not a number"}', { schema } as any);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBeDefined();
  });

  it('should fail when output is not valid JSON', () => {
    const result = matchJsonSchema('not json at all', { schema } as any);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('Output is not valid JSON');
  });
});
