import { describe, expect, it } from 'vitest';

import { RequestTrigger } from '../../agentRuntime';
import { UpdateMessageParamsSchema } from '../db/params';
import {
  ClientMessageMetadataSchema,
  MessageMetadataSchema,
  omitServerOwnedMessageMetadata,
} from './metadata';

describe('MessageMetadataSchema', () => {
  it('preserves the native Codex turn separately from message item provenance', () => {
    const metadata = {
      codexTurnId: 'turn-7',
      heteroMessageId: 'item-3',
      heteroSessionId: 'native-thread',
    };
    expect(MessageMetadataSchema.parse(metadata)).toEqual(metadata);
  });
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

  it('preserves the agent sender block so an agent → agent turn keeps its author', () => {
    const parsed = MessageMetadataSchema.parse({
      agentSender: {
        agentId: 'agt_coco',
        avatar: 'https://a.com/coco.png',
        name: 'Coco',
        title: 'Product Agent',
        topicId: 'tpc_source',
        topicTitle: 'Release risk review',
      },
      unknown: 'stripped',
    });

    expect(parsed).toEqual({
      agentSender: {
        agentId: 'agt_coco',
        avatar: 'https://a.com/coco.png',
        name: 'Coco',
        title: 'Product Agent',
        topicId: 'tpc_source',
        topicTitle: 'Release risk review',
      },
    });
  });
});

/**
 * `agentSender` renders a message as another agent's, so only the server may
 * write it — a client must not be able to forge it through a message write.
 */
describe('client-writable message metadata', () => {
  const forged = { agentId: 'agt_victim', name: 'Victim Agent' };

  it('drops agentSender from client metadata and keeps the rest', () => {
    expect(ClientMessageMetadataSchema.parse({ agentSender: forged, collapsed: true })).toEqual({
      collapsed: true,
    });
  });

  it('drops agentSender from a message.update payload', () => {
    const parsed = UpdateMessageParamsSchema.parse({
      content: 'edited',
      metadata: { agentSender: forged, collapsed: true },
    });

    expect(parsed.metadata).toEqual({ collapsed: true });
  });

  it('drops agentSender from untyped metadata without touching other keys', () => {
    expect(omitServerOwnedMessageMetadata({ agentSender: forged, custom: 1 })).toEqual({
      custom: 1,
    });
    expect(omitServerOwnedMessageMetadata(undefined)).toBeUndefined();
    const clean = { custom: 1 };
    expect(omitServerOwnedMessageMetadata(clean)).toBe(clean);
  });
});
