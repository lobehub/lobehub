import { describe, expect, it } from 'vitest';

import { initialTopicMetadataSchema } from './index';

describe('initialTopicMetadataSchema', () => {
  it('carries every field a first send needs to be born with', () => {
    // These travel because the server cannot read the client's pre-topic state.
    // A key this schema does not know is stripped without a word and the call
    // still answers 200, so the loss is invisible from both ends — which is why
    // the assertion is on the parse rather than on any caller.
    const metadata = {
      repos: ['lobehub/lobehub'],
      sandboxInstanceId: 'a2c1d0e4-0000-4000-8000-000000000000',
      sandboxMode: 'persistent' as const,
      workingDirectory: 'projects/atlas',
    };

    expect(initialTopicMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  it('rejects a sandbox mode outside the pair', () => {
    expect(initialTopicMetadataSchema.safeParse({ sandboxMode: 'forever' }).success).toBe(false);
  });

  it('accepts an empty patch — a conversation may start with none of this', () => {
    expect(initialTopicMetadataSchema.parse({})).toEqual({});
  });
});
