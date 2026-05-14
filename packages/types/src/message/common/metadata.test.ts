import { describe, expect, it } from 'vitest';

import { RequestTrigger } from '../../agentRuntime';
import { MessageMetadataSchema } from './metadata';

describe('MessageMetadataSchema', () => {
  it('preserves request trigger metadata during runtime parsing', () => {
    const parsed = MessageMetadataSchema.parse({
      trigger: RequestTrigger.Onboarding,
      unknown: 'stripped',
    });

    expect(parsed).toEqual({ trigger: RequestTrigger.Onboarding });
  });
});
