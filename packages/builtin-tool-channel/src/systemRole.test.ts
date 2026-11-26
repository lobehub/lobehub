import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('Channel systemPrompt', () => {
  // How to put a card somewhere other than the answer lives with the tool that does it, so only a
  // run that has lobe-channel postMessage is told about it.
  it('tells the run how to post a card elsewhere, and that a posted card is not posted again', () => {
    expect(systemPrompt).toContain('to put a card somewhere else, draw it first, then post');
    expect(systemPrompt).toContain('neither by a later postMessage nor with your final answer');
    expect(systemPrompt).toContain('surfaceIds');
  });
});
