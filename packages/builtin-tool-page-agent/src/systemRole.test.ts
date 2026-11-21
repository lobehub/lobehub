import { documentBlocksPrompt } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('should tell the agent which rich blocks pages support', () => {
    expect(systemPrompt).toContain(documentBlocksPrompt);
  });
});
