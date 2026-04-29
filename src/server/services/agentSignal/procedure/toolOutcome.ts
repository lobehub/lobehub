import type { AgentSignalSource, RuntimeProcessorResult } from '@lobechat/agent-signal';
import { createSignal } from '@lobechat/agent-signal';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from '../policies/types';
import type { RuntimeProcessorContext } from '../runtime/context';
import { defineSourceHandler } from '../runtime/middleware';
import { createProcedureKey, getCoarseProcedureDomain } from './keys';
import { createProcedureMarker } from './marker';
import { createProcedureRecord } from './record';
import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureReceipt,
  AgentSignalProcedureRecord,
} from './types';

/**
 * Storage dependencies for the tool outcome procedure source handler.
 */
export interface ToolOutcomeProcedureDeps {
  /** Appends a record into domain accumulation state. */
  accumulator: { appendRecord: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** Writes handled markers after record persistence succeeds. */
  markerStore: { write: (marker: AgentSignalProcedureMarker) => Promise<void> };
  /** Provides a consistent millisecond timestamp for procedure writes. */
  now: () => number;
  /** Appends context receipts for compact continuity. */
  receiptStore: { append: (receipt: AgentSignalProcedureReceipt) => Promise<void> };
  /** Writes the compact procedure record. */
  recordStore: { write: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** TTL used for marker expiration and policy-state writes. */
  ttlSeconds: number;
}

const TOOL_OUTCOME_SOURCE_TYPES = [
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
] as const;

interface ToolOutcomePayload {
  domainKey?: string;
  intentClass?: string;
  messageId?: string;
  operationId?: string;
  outcome?: { status?: string; summary?: string };
  relatedObjects?: AgentSignalProcedureRecord['relatedObjects'];
  toolCallId?: string;
}

const shouldWriteHandledMarker = (input: {
  domainKey: string;
  intentClass?: string;
  status: string;
}) => {
  if (input.status !== 'succeeded' && input.status !== 'skipped') return false;

  const domain = getCoarseProcedureDomain(input.domainKey);
  if (domain === 'memory') {
    return input.intentClass === 'explicit_persistence';
  }
  if (domain === 'skill') {
    return input.intentClass === 'tool_command' || input.intentClass === 'explicit_persistence';
  }

  return false;
};

/**
 * Creates the source handler that normalizes direct tool outcomes into procedure projections.
 *
 * Use when:
 * - Direct memory, skill, or document tools emit generic outcome sources
 * - Same-turn suppression needs the synchronous procedure projection to already exist
 *
 * Expects:
 * - Dependencies write records before markers
 * - Source payloads use `tool.outcome.completed` or `tool.outcome.failed`
 *
 * Returns:
 * - Source handler that dispatches a `signal.tool.outcome` signal
 */
export const createToolOutcomeSourceHandler = (deps: ToolOutcomeProcedureDeps) =>
  defineSourceHandler(
    TOOL_OUTCOME_SOURCE_TYPES,
    'source.tool-outcome.procedure',
    async (
      source: AgentSignalSource,
      context: RuntimeProcessorContext,
    ): Promise<RuntimeProcessorResult | void> => {
      const payload = source.payload as ToolOutcomePayload;
      if (!payload.domainKey || !payload.outcome?.status) return;

      const signal = createSignal({
        payload: source.payload,
        signalId: `${source.sourceId}:signal:tool-outcome`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.toolOutcome,
        source,
        timestamp: source.timestamp,
      });
      const now = deps.now();
      const record = createProcedureRecord({
        accumulatorRole: 'context',
        cheapScoreDelta: 0,
        createdAt: now,
        domainKey: payload.domainKey,
        id: `procedure-record:${source.sourceId}`,
        intentClass: payload.intentClass,
        refs: { signalIds: [signal.signalId], sourceIds: [source.sourceId] },
        relatedObjects: payload.relatedObjects,
        scopeKey: context.scopeKey,
        status: payload.outcome.status === 'failed' ? 'failed' : 'handled',
        summary: payload.outcome.summary,
      });

      await deps.recordStore.write(record);
      await deps.accumulator.appendRecord(record);

      const procedureKey = createProcedureKey({
        messageId: payload.messageId,
        operationId: payload.operationId,
        rootSourceId: source.chain.rootSourceId,
        toolCallId: payload.toolCallId,
      });

      if (
        shouldWriteHandledMarker({
          domainKey: payload.domainKey,
          intentClass: payload.intentClass,
          status: payload.outcome.status,
        })
      ) {
        await deps.markerStore.write(
          createProcedureMarker({
            createdAt: now,
            domainKey: payload.domainKey,
            expiresAt: now + deps.ttlSeconds * 1000,
            intentClass: payload.intentClass,
            markerType: 'handled',
            procedureKey,
            recordId: record.id,
            scopeKey: context.scopeKey,
            signalId: signal.signalId,
            sourceId: source.sourceId,
          }),
        );
      }

      await deps.receiptStore.append({
        createdAt: now,
        domainKey: payload.domainKey,
        id: `procedure-receipt:${record.id}`,
        intentClass: payload.intentClass,
        messageId: payload.messageId,
        recordIds: [record.id],
        relatedObjects: payload.relatedObjects,
        scopeKey: context.scopeKey,
        sourceId: source.sourceId,
        status: payload.outcome.status === 'failed' ? 'failed' : 'handled',
        summary: payload.outcome.summary ?? `${payload.domainKey} tool outcome handled.`,
        updatedAt: now,
      });

      return { signals: [signal], status: 'dispatch' };
    },
  );
