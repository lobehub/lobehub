// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentRouter } from '.';

/**
 * `createAgent` stores any tag string (`CreateAgentSchema`), so the list/count
 * filters must accept every tag it can store: a stricter read-side limit would
 * leave an agent that `lh agent list --tag` can never return.
 */
describe('queryAgents / countAgents tag input', () => {
  const procedures = (agentRouter as any)._def.procedures as Record<string, any>;
  const parse = (name: string, input: unknown) => procedures[name]._def.inputs[0].parse(input);
  const longTag = `team-${'x'.repeat(120)}`;

  it.each(['queryAgents', 'countAgents'])('%s accepts a long tag and trims it', (name) => {
    expect(parse(name, { tag: `  ${longTag}  ` })).toMatchObject({ tag: longTag });
  });

  it.each(['queryAgents', 'countAgents'])('%s rejects a blank tag', (name) => {
    expect(() => parse(name, { tag: '   ' })).toThrow();
  });
});
