import { randomUUID } from 'node:crypto';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { GatewayMuxClient } from '@lobechat/agent-gateway-client';

import { getTrpcClient, type TrpcClient } from '../../../src/api/client';
import { resolveAgentGatewayUrl } from '../../../src/settings';
import type { ClientMark, ReceivedEvent, ScenarioName, TurnRecord } from './metrics';

/** Mirrors the Web composer (`src/services/aiAgent.ts`): protocol v2 delivery. */
const CLIENT_PROTOCOL_VERSION = 2;
const STREAM_FEATURES = ['file_works', 'member_runtime_end'];

export interface TurnInput {
  agentId: string;
  /** What to do when Claude Code asks for permission. */
  approval?: 'approve' | 'reject';
  fileIds?: string[];
  permissionMode?: 'bypassPermissions' | 'default';
  prompt: string;
  scenario: ScenarioName;
  /** Give up on a turn that never ends. */
  timeoutMs: number;
  /** Continue this topic (Claude Code resumes its session) instead of opening one. */
  topicId?: string;
}

/**
 * A bench client that behaves like the Web app on a gateway-mode Claude Code
 * agent: one page-wide multiplexed socket dialed up front, `execAgent` with the
 * Web's protocol and stream features, and approvals resolved through the same
 * durable source path the approval card uses.
 */
export class BenchSession {
  private constructor(
    private readonly client: TrpcClient,
    private readonly mux: GatewayMuxClient,
  ) {}

  static async open(): Promise<BenchSession> {
    const client = await getTrpcClient();
    const gatewayUrl = resolveAgentGatewayUrl();
    if (!gatewayUrl) throw new Error('No agent gateway URL is configured');
    const mux = new GatewayMuxClient({
      gatewayUrl,
      getToken: async () => (await client.aiAgent.issueGatewayUserToken.query()).token,
      keepAlive: true,
    });
    // The Web app dials on app entry, so a send never pays for the handshake.
    await mux.connect();
    return new BenchSession(client, mux);
  }

  close() {
    this.mux.disconnect();
  }

  async runTurn(input: TurnInput): Promise<TurnRecord> {
    const events: ReceivedEvent[] = [];
    const marks: Partial<Record<ClientMark, number>> = {};
    const record: TurnRecord = { events, marks, scenario: input.scenario };

    const sentAt = performance.now();
    record.sentAtEpoch = Date.now();
    const since = () => Math.round(performance.now() - sentAt);

    let settle!: () => void;
    let fail!: (error: Error) => void;
    const ended = new Promise<void>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // Frames can arrive before `execAgent` answers; keep them until we know the
    // operation, the same way the Web buffers its early gateway events.
    const onEvent = (event: AgentStreamEvent) => {
      const data = event.data as Record<string, any> | undefined;
      events.push({
        at: since(),
        detail:
          data?.phase === 'permission_mode'
            ? `permission_mode:${data.permissionMode}${data.fallback ? `(fallback ${data.fallback})` : ''}`
            : (data?.chunkType ?? data?.phase),
        serverTimestamp: event.timestamp,
        type: event.type,
      });
      if (event.type === 'agent_intervention_request' && input.approval) {
        void this.resolveApproval(record, input, data?.toolCallId, since).catch(fail);
      }
      // A failed run is not a latency sample: fail the bench instead.
      if (event.type === 'error')
        fail(new Error(`turn failed: ${data?.message ?? JSON.stringify(data)}`));
      if (event.type === 'agent_runtime_end') settle();
    };

    const result = (await this.client.aiAgent.execAgent.mutate({
      agentId: input.agentId,
      appContext: {
        ...(input.topicId ? { topicId: input.topicId } : {}),
        ...(!input.topicId && input.permissionMode
          ? { initialTopicMetadata: { heteroPermissionMode: input.permissionMode } }
          : {}),
      },
      clientProtocol: CLIENT_PROTOCOL_VERSION,
      ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}),
      prompt: input.prompt,
      streamFeatures: STREAM_FEATURES,
    } as any)) as { operationId?: string; success?: boolean; topicId?: string; error?: string };
    marks.ack = since();
    if (!result.success || !result.operationId)
      throw new Error(`execAgent failed: ${result.error ?? JSON.stringify(result)}`);
    record.operationId = result.operationId;
    record.topicId = result.topicId;

    // From the start of the stream: the hub replays what was emitted before we
    // subscribed, and those replays are timestamped on arrival like the Web's.
    const subscription = this.mux.subscribe(result.operationId, { lastEventId: '0' });
    subscription.on('agent_event', onEvent);

    const timeout = setTimeout(
      () => fail(new Error(`turn did not end within ${input.timeoutMs}ms`)),
      input.timeoutMs,
    );
    try {
      await ended;
    } finally {
      clearTimeout(timeout);
      subscription.unsubscribe();
    }
    return record;
  }

  /**
   * Do what the Claude Code permission card does: reload the topic's rows (the
   * card renders from the tool row's `pluginIntervention`), then pick the
   * card's "Allow" or "Deny" option through the source path
   * (`submitHeteroIntervention` → `select_provider_option`).
   */
  private async resolveApproval(
    record: TurnRecord,
    input: TurnInput,
    toolCallId: string | undefined,
    since: () => number,
  ) {
    if (!toolCallId || record.marks.resolveSent !== undefined) return;
    const tool = await this.findPendingToolRow(input.agentId, record.topicId!, toolCallId);
    record.marks.approvalCard = since();
    if (!tool) throw new Error(`approval card row for ${toolCallId} was not found`);

    record.marks.resolveSent = since();
    await this.client.aiAgent.resolveAgentInterventionBySource.mutate({
      action: {
        optionId: input.approval === 'approve' ? 'allow' : 'deny',
        type: 'select_provider_option',
      },
      batchId: tool.batchId,
      operationId: tool.operationId,
      resolutionRequestId: randomUUID(),
      streamFeatures: STREAM_FEATURES,
      targets: [{ toolCallId, toolMessageId: tool.id }],
    } as any);
    record.marks.resolveAck = since();
  }

  private async findPendingToolRow(agentId: string, topicId: string, toolCallId: string) {
    // The request frame can beat the row's commit by a few ms on a cold
    // replica; the Web re-reads on the next frame, so retry briefly here too.
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = (await this.client.message.getMessages.query({ agentId, topicId } as any)) as {
        id: string;
        pluginIntervention?: { batchId?: string; operationId?: string; status?: string };
        tool_call_id?: string;
      }[];
      const row = rows.find((message) => message.tool_call_id === toolCallId);
      const intervention = row?.pluginIntervention;
      if (row && intervention?.batchId && intervention.operationId)
        return { batchId: intervention.batchId, id: row.id, operationId: intervention.operationId };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  }
}
