import type { AgentSignalPolicyStateStore } from '../store/types';
import { getCoarseProcedureDomain, PROCEDURE_RECEIPTS_POLICY_ID } from './keys';
import type {
  AgentSignalProcedureReceipt,
  MessageAgentSignalProcedureReceiptEnvelope,
} from './types';

/**
 * Options for appending procedure receipts.
 */
export interface AppendProcedureReceiptOptions {
  /** Maximum receipts readers should keep visible. */
  maxItems: number;
  /** Policy-state ttl in seconds. */
  ttlSeconds: number;
}

/**
 * Appends one receipt field to the scope-local receipt map.
 *
 * Use when:
 * - A procedure record should become visible to context continuity
 * - Concurrent receipt writes must avoid replacing each other
 *
 * Expects:
 * - Store writes merge hash fields
 *
 * Returns:
 * - Resolves after the receipt field is persisted
 */
export const appendProcedureReceipt = async (
  store: AgentSignalPolicyStateStore,
  receipt: AgentSignalProcedureReceipt,
  options: AppendProcedureReceiptOptions,
) => {
  // Receipt writes use one hash field per receipt to avoid overwriting concurrent receipt updates.
  // Readers sort and trim after reading the hash.
  await store.writePolicyState(
    PROCEDURE_RECEIPTS_POLICY_ID,
    receipt.scopeKey,
    { [`receipt:${receipt.id}`]: JSON.stringify(receipt) },
    options.ttlSeconds,
  );
};

/**
 * Reads recent procedure receipts for one runtime scope.
 *
 * Use when:
 * - Rendering compact context continuity
 * - Inspecting recent procedure outcomes
 *
 * Expects:
 * - Receipt fields are JSON written by {@link appendProcedureReceipt}
 *
 * Returns:
 * - Receipts sorted newest first and trimmed to `maxItems`
 */
export const readProcedureReceipts = async (
  store: Pick<AgentSignalPolicyStateStore, 'readPolicyState'>,
  scopeKey: string,
  maxItems: number,
) => {
  const state = await store.readPolicyState(PROCEDURE_RECEIPTS_POLICY_ID, scopeKey);

  return Object.entries(state ?? {})
    .filter(([key]) => key.startsWith('receipt:'))
    .map(([, value]) => JSON.parse(value) as AgentSignalProcedureReceipt)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxItems);
};

/**
 * Converts a receipt into compact message metadata.
 *
 * Use when:
 * - Persisting recent procedure status into message metadata
 * - Hiding internal acknowledged state from message consumers
 *
 * Expects:
 * - Receipt summary is already compact and safe for context
 *
 * Returns:
 * - Message metadata envelope
 */
export const toMessageReceiptEnvelope = (
  receipt: AgentSignalProcedureReceipt,
): MessageAgentSignalProcedureReceiptEnvelope => ({
  domainKey: receipt.domainKey,
  id: receipt.id,
  status: receipt.status === 'acknowledged' ? 'processing' : receipt.status,
  summary: receipt.summary,
  updatedAt: receipt.updatedAt,
});

/**
 * Merges one receipt envelope into message metadata.
 *
 * Use when:
 * - Updating compact message metadata after a procedure outcome
 * - Preserving unrelated metadata keys
 *
 * Expects:
 * - Existing `agentSignalReceipts` may be absent or malformed
 *
 * Returns:
 * - Metadata with a deduplicated recent receipt list
 */
export const mergeMessageReceiptEnvelope = (
  metadata: Record<string, unknown> | undefined,
  envelope: MessageAgentSignalProcedureReceiptEnvelope,
) => {
  const existing = Array.isArray(metadata?.agentSignalReceipts)
    ? (metadata.agentSignalReceipts as MessageAgentSignalProcedureReceiptEnvelope[])
    : [];

  return {
    ...metadata,
    agentSignalReceipts: [...existing.filter((item) => item.id !== envelope.id), envelope].slice(
      -8,
    ),
  };
};

/**
 * Renders procedure receipts into a compact context summary.
 *
 * Use when:
 * - Injecting recent causal facts back into model context
 * - Hiding internal receipt ids and marker state
 *
 * Expects:
 * - Receipt summaries are user-safe compact text
 *
 * Returns:
 * - A newline-delimited context summary, or empty string when nothing is visible
 */
export const renderProcedureReceiptContext = (receipts: AgentSignalProcedureReceipt[]) => {
  const visible = receipts
    .filter((receipt) => receipt.status !== 'failed' || receipt.summary.length > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 5);

  if (visible.length === 0) return '';

  return [
    'Recent Agent Signal updates:',
    ...visible.map(
      (receipt) => `${'-'} ${getCoarseProcedureDomain(receipt.domainKey)}: ${receipt.summary}`,
    ),
  ].join('\n');
};
