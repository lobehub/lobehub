// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentRouter } from '.';

/**
 * `createAgent` stores tag strings exactly as given (`CreateAgentSchema`: no
 * length cap, no trimming), so the list/count filters must look up that exact
 * value, the empty string included: a stricter or normalizing read side would leave agents that
 * `lh agent list --tag` can never return.
 */
describe('queryAgents / countAgents tag input', () => {
  const procedures = (agentRouter as any)._def.procedures as Record<string, any>;
  const parse = (name: string, input: unknown) => procedures[name]._def.inputs[0].parse(input);

  it.each(['queryAgents', 'countAgents'])('%s accepts a long tag', (name) => {
    const longTag = `team-${'x'.repeat(120)}`;
    expect(parse(name, { tag: longTag })).toMatchObject({ tag: longTag });
  });

  it.each(['queryAgents', 'countAgents'])('%s keeps the tag exactly as stored', (name) => {
    expect(parse(name, { tag: ' tenant-A ' })).toMatchObject({ tag: ' tenant-A ' });
    expect(parse(name, { tag: ' ' })).toMatchObject({ tag: ' ' });
  });

  it.each(['queryAgents', 'countAgents'])('%s keeps an empty tag (a stored value too)', (name) => {
    expect(parse(name, { tag: '' })).toMatchObject({ tag: '' });
  });
});
