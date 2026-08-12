import { describe, expect, it } from 'vitest';

import { RequestTrigger } from '../../agentRuntime';
import { MessageMetadataSchema } from './metadata';

describe('MessageMetadataSchema', () => {
  it('preserves explicit internal agent-dispatch semantics', () => {
    const parsed = MessageMetadataSchema.parse({
      agentDispatch: { kind: 'callAgent', visibility: 'internal' },
      unknown: 'stripped',
    });

    expect(parsed).toEqual({
      agentDispatch: { kind: 'callAgent', visibility: 'internal' },
    });
  });

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

  it('preserves the operation id provenance stamp so it is not stripped on writes', () => {
    const parsed = MessageMetadataSchema.parse({
      operationId: 'op-1',
      unknown: 'stripped',
    });

    expect(parsed).toEqual({ operationId: 'op-1' });
  });

  it('preserves the durable heterogeneous tool-state watermark', () => {
    const parsed = MessageMetadataSchema.parse({
      heterogeneousToolStateOperationId: 'op-1',
      heterogeneousToolStateSeq: 4,
    });

    expect(parsed).toEqual({
      heterogeneousToolStateOperationId: 'op-1',
      heterogeneousToolStateSeq: 4,
    });
  });
});
