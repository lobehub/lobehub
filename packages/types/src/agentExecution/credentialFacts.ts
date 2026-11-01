import type { CredType } from '../creds';

/**
 * One credential as the run's prompt lists it. Structurally the `CredSummary`
 * the creds tool renders, redeclared here so the state type does not depend on
 * a builtin-tool package.
 */
export interface CredentialFact {
  description?: string;
  key: string;
  name: string;
  /** Present only for a workspace's merged view: who the credential belongs to. */
  ownerDisplayName?: string;
  ownerType?: 'organization' | 'user';
  type: CredType;
}

/**
 * The credentials an operation listed once when it was created, carried on
 * `AgentState` so a step renders `{{CREDS_LIST}}` from the snapshot instead of
 * asking the Market API again on every LLM attempt.
 *
 * Dropped the moment the run itself saves or connects a credential: from there
 * the list can change between two steps, so the remaining steps read it live.
 * Absent on operations created before the snapshot existed, and on runs that
 * activated the creds tool after they started.
 */
export interface FrozenCredentialFacts {
  credentials: CredentialFact[];
  /**
   * The scope the list was read in. Inside a workspace an agent only sees the
   * workspace's shared credentials, so a snapshot taken in another scope must
   * not be reused.
   */
  workspaceId?: string;
}
