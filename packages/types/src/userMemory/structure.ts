/**
 * Value domains for the structured memory model: context → dossier → activity (evidence),
 * entities with names, and the operation log the extraction pipeline writes through.
 * Columns store these as plain text, so adding a value needs no migration.
 */

/**
 * Workspace visibility of a memory row, as for agents / projects: `private` is owner-only,
 * `public` is shared with the workspace (agent / project memory). Personal memory stays private.
 */
export type UserMemoryVisibility = 'private' | 'public';

/** Whether a memory may be used in conversations yet. */
export type UserMemoryState = 'hypothesis' | 'active' | 'superseded' | 'rejected';

/** Derived from the latest evidence, never from what an extractor wrote. */
export type UserMemoryDossierStatus = 'active' | 'dormant' | 'closed';

export interface UserMemoryDossierDecision {
  /** The activity this decision was read from. */
  activityId?: string;
  date: string;
  text: string;
}

/** How a context came to be linked to a project. */
export type UserMemoryContextProjectSource = 'topic' | 'inferred' | 'user';

export type UserMemoryEntityType =
  | 'self'
  | 'person'
  | 'org'
  | 'customer'
  | 'investor'
  | 'product'
  | 'repo'
  | 'project'
  | 'place'
  | 'other';

/** `former` is an old name (LobeChat → LobeHub); `wrong` must never be used again. */
export type UserMemoryEntityNameKind = 'alias' | 'former' | 'wrong';

/** Who said it: the holder themself, the user relaying it, or the model inferring it. */
export type UserMemoryEvidenceSource = 'stated' | 'reported' | 'inferred';

/**
 * Relation carried by a `user_memories_edges` row. `mentions`: a memory mentions an entity;
 * `distinct_from`: two entities are stated not to be the same thing (stored once, smaller id first);
 * `supersedes` / `contradicts`: one memory replaces or conflicts with another.
 */
export type UserMemoryEdgeRelation =
  'mentions' | 'distinct_from' | 'supersedes' | 'contradicts' | 'related_to';

export type UserMemoryOperationType =
  'attach' | 'create' | 'merge' | 'split' | 'alias' | 'supersede' | 'route' | 'drop' | 'status';

export type UserMemoryOperationActor = 'pipeline' | 'user' | 'agent';

/** `held` waits for more evidence; `asked` is waiting for the user. */
export type UserMemoryOperationGate = 'auto' | 'held' | 'asked' | 'user';

export type UserMemoryOperationState = 'applied' | 'pending' | 'rejected' | 'reverted';
