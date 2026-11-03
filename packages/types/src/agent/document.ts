/**
 * Persisted enum on `agent_documents.policy_load` (varchar(30)).
 *
 * - `always` — inject the full content on every step.
 * - `progressive` — surface in the progressive-disclosure index; the model
 *   must call `readDocument(id)` to fetch full content.
 * - `disabled` — soft-off. The row is kept (still restorable / auditable)
 *   but must not participate in the injection pipeline. Also written by
 *   the soft-delete path.
 */
export type AgentDocumentPolicyLoad = 'always' | 'progressive' | 'disabled';

export const AGENT_DOCUMENT_POLICY_LOADS = [
  'always',
  'progressive',
  'disabled',
] as const satisfies readonly AgentDocumentPolicyLoad[];
