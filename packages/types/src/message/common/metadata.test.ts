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

  it('preserves hetero-agent session provenance so it is not stripped on writes', () => {
    const parsed = MessageMetadataSchema.parse({
      heteroMessageId: 'cc-1',
      heteroSessionId: 'sess-A',
      unknown: 'stripped',
    });

    expect(parsed).toEqual({ heteroMessageId: 'cc-1', heteroSessionId: 'sess-A' });
  });
});
