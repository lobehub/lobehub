import type { AgentSignalState } from './initialState';
import {
  agentSignalReceiptsKey,
  type AgentSignalReceiptsParams,
  type AgentSignalReceiptView,
} from './projection';

/** One topic's receipts, or `undefined` before their first paint. */
const getReceipts =
  (params?: AgentSignalReceiptsParams | null) =>
  (s: AgentSignalState): AgentSignalReceiptView[] | undefined =>
    params ? s.agentSignalReceiptsMap[agentSignalReceiptsKey(params)] : undefined;

export const agentSignalSelectors = {
  getReceipts,
};
