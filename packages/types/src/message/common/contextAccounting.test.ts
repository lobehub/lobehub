import { describe, expect, it } from 'vitest';

import { MessageContextAccountingSchema } from './contextAccounting';
import { MessageMetadataSchema } from './metadata';

const accounting = {
  bySource: {
    content: 1,
    fileContext: 2,
    reasoning: 3,
    thoughtSignature: 4,
    toolCallId: 5,
    toolCalls: 6,
    toolDefinition: 7,
  },
  estimator: 'tokenx' as const,
  messageCount: 3,
  system: 10,
  total: 38,
};

describe('MessageContextAccountingSchema', () => {
  it('keeps a recorded accounting through message metadata writes', () => {
    expect(
      MessageMetadataSchema.parse({ contextAccounting: accounting }).contextAccounting,
    ).toEqual(accounting);
  });

  it('coerces a shape from another runtime version instead of rejecting the write', () => {
    expect(
      MessageContextAccountingSchema.parse({
        bySource: { content: 1, image: 9 },
        estimator: 'o200k',
        messageCount: 1,
        system: 2,
        total: 3,
      }),
    ).toEqual({
      bySource: {
        ...accounting.bySource,
        content: 1,
        fileContext: 0,
        reasoning: 0,
        thoughtSignature: 0,
        toolCallId: 0,
        toolCalls: 0,
        toolDefinition: 0,
      },
      estimator: 'tokenx',
      messageCount: 1,
      system: 2,
      total: 3,
    });
  });
});
