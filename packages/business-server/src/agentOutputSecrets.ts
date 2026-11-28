/**
 * Credentials found in what a heterogeneous agent run printed. The server
 * redacts them before anything is stored or streamed; this hook lets a
 * deployment react to the finding. The open-source build does nothing more.
 */

export type AgentOutputSecretKind =
  'anthropic-api-key' | 'anthropic-oauth-token' | 'anthropic-token';

export interface AgentOutputSecret {
  /** First 16 hex characters of the SHA-256 of the secret: matches it without storing it. */
  fingerprint: string;
  kind: AgentOutputSecretKind;
}

export interface AgentOutputSecretDetection {
  agentType: string;
  operationId: string;
  /** Distinct secrets in the batch. */
  secrets: AgentOutputSecret[];
  topicId: string;
  userId: string;
  workspaceId?: string;
}

/** Called once per ingest batch that contained credentials. A rejection is logged and ignored. */
export const onAgentOutputSecretsDetected = async (
  _detection: AgentOutputSecretDetection,
): Promise<void> => {};
