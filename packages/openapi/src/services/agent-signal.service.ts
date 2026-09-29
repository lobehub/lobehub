import type {
  AGENT_SIGNAL_CLIENT_SOURCE_TYPES,
  AgentSignalSourceEventInput,
} from '@lobechat/agent-signal/source';

import type { LobeChatDatabase } from '@/database/type';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { listAgentSignalReceipts } from '@/server/services/agentSignal/services/receiptService';
import { buildTriggerSourceEvent } from '@/server/services/agentSignal/triggerSourceEvent';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  EmitSourceEventRequest,
  ListReceiptsQuery,
  TriggerSourceEventRequest,
} from '../types/agent-signal.type';

type ClientSourceType = (typeof AGENT_SIGNAL_CLIENT_SOURCE_TYPES)[number];
type ClientSourceEventInput = AgentSignalSourceEventInput<ClientSourceType>;

/**
 * Agent Signal REST service — the event-driven half of "proactive".
 *
 * A signal is what wakes an agent outside a conversation: an inbound mail, a
 * calendar change, a file landing. Both endpoints reuse the same enqueue path
 * the in-app producers use, so routing, dedupe and receipts behave identically.
 */
export class AgentSignalRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  async emitSourceEvent(input: EmitSourceEventRequest): ServiceResult<unknown> {
    return enqueueAgentSignalSourceEvent(input as unknown as ClientSourceEventInput, {
      agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  async triggerSourceEvent(input: TriggerSourceEventRequest): ServiceResult<unknown> {
    const sourceEvent = buildTriggerSourceEvent({
      agentId: input.agentId,
      payloadOverride: input.payloadOverride,
      scopeKey: input.scopeKey,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      timestamp: input.timestamp,
      topicId: input.topicId,
      userId: this.userId,
    });

    return enqueueAgentSignalSourceEvent(sourceEvent, {
      agentId: input.agentId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  async listReceipts(query: ListReceiptsQuery): ServiceResult<unknown> {
    return listAgentSignalReceipts({
      agentId: query.agentId,
      cursor: query.cursor,
      limit: query.limit ?? 20,
      sinceCreatedAt: query.sinceCreatedAt,
      topicId: query.topicId,
      userId: this.userId,
    });
  }
}
