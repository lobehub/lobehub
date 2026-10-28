/**
 * Row and insert shapes of the user memory tables. These are the types the rest of the code base
 * imports; database code annotates its queries with them instead of inferring from the schema.
 * `packages/database/src/schemas/userMemories/rowTypes.check.ts` asserts they are identical to the
 * tables, so a schema change that is not mirrored here fails `type-check`.
 */
import type {
  UserMemoryContextProjectSource,
  UserMemoryDossierDecision,
  UserMemoryDossierStatus,
  UserMemoryEdgeRelation,
  UserMemoryEntityNameKind,
  UserMemoryEntityType,
  UserMemoryEvidenceSource,
  UserMemoryOperationActor,
  UserMemoryOperationGate,
  UserMemoryOperationState,
  UserMemoryOperationType,
  UserMemoryState,
} from './structure';

/** Row of `user_memories` — the parent row every layer hangs off. */
export interface UserMemory {
  accessedAt: Date;
  accessedCount: number | null;
  capturedAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
  details: string | null;
  detailsVector1024: number[] | null;
  id: string;
  isDeleted: boolean | null;
  lastAccessedAt: Date;
  memoryCategory: string | null;
  memoryLayer: string | null;
  memoryType: string | null;
  metadata: Record<string, unknown> | null;
  state: UserMemoryState | null;
  status: string | null;
  summary: string | null;
  summaryVector1024: number[] | null;
  tags: string[] | null;
  title: string | null;
  updatedAt: Date;
  userId: string | null;
  userLocked: boolean | null;
}

/** Insert shape of `UserMemory`: required columns have no database default. */
export interface UserMemoryInsert {
  accessedAt?: Date;
  accessedCount?: number | null;
  capturedAt?: Date;
  createdAt?: Date;
  deletedAt?: Date | null;
  details?: string | null;
  detailsVector1024?: number[] | null;
  id?: string;
  isDeleted?: boolean | null;
  lastAccessedAt: Date;
  memoryCategory?: string | null;
  memoryLayer?: string | null;
  memoryType?: string | null;
  metadata?: Record<string, unknown> | null;
  state?: UserMemoryState | null;
  status?: string | null;
  summary?: string | null;
  summaryVector1024?: number[] | null;
  tags?: string[] | null;
  title?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userLocked?: boolean | null;
}

/** Row of `user_memories_contexts` — level 1: a long-running situation. */
export interface UserMemoryContext {
  accessedAt: Date;
  associatedObjects: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  associatedSubjects: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  capturedAt: Date;
  createdAt: Date;
  currentStatus: string | null;
  description: string | null;
  descriptionVector: number[] | null;
  firstSeenAt: Date | null;
  id: string;
  lastEvidenceAt: Date | null;
  metadata: Record<string, unknown> | null;
  nextSteps: string[] | null;
  now: string | null;
  openQuestions: string[] | null;
  scoreImpact: number | null;
  scoreUrgency: number | null;
  synthesizedAt: Date | null;
  tags: string[] | null;
  title: string | null;
  type: string | null;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
  userMemoryIds: string[] | null;
}

/** Insert shape of `UserMemoryContext`: required columns have no database default. */
export interface UserMemoryContextInsert {
  accessedAt?: Date;
  associatedObjects?: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  associatedSubjects?: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  capturedAt?: Date;
  createdAt?: Date;
  currentStatus?: string | null;
  description?: string | null;
  descriptionVector?: number[] | null;
  firstSeenAt?: Date | null;
  id?: string;
  lastEvidenceAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  nextSteps?: string[] | null;
  now?: string | null;
  openQuestions?: string[] | null;
  scoreImpact?: number | null;
  scoreUrgency?: number | null;
  synthesizedAt?: Date | null;
  tags?: string[] | null;
  title?: string | null;
  type?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
  userMemoryIds?: string[] | null;
}

/** Row of `user_memories_dossiers` — level 2: a concrete item inside a context. */
export interface UserMemoryDossier {
  accessedAt: Date;
  activityCount: number;
  contextId: string | null;
  createdAt: Date;
  decisions: UserMemoryDossierDecision[] | null;
  firstSeenAt: Date | null;
  id: string;
  lastEvidenceAt: Date | null;
  metadata: Record<string, unknown> | null;
  now: string | null;
  status: UserMemoryDossierStatus;
  summary: string | null;
  summaryVector: number[] | null;
  title: string | null;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryDossier`: required columns have no database default. */
export interface UserMemoryDossierInsert {
  accessedAt?: Date;
  activityCount?: number;
  contextId?: string | null;
  createdAt?: Date;
  decisions?: UserMemoryDossierDecision[] | null;
  firstSeenAt?: Date | null;
  id?: string;
  lastEvidenceAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  now?: string | null;
  status?: UserMemoryDossierStatus;
  summary?: string | null;
  summaryVector?: number[] | null;
  title?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_context_projects` — a context linked to a project. */
export interface UserMemoryContextProject {
  accessedAt: Date;
  contextId: string;
  createdAt: Date;
  evidenceCount: number;
  id: string;
  isPrimary: boolean;
  metadata: Record<string, unknown> | null;
  projectId: string;
  source: UserMemoryContextProjectSource;
  updatedAt: Date;
  userId: string | null;
}

/** Insert shape of `UserMemoryContextProject`: required columns have no database default. */
export interface UserMemoryContextProjectInsert {
  accessedAt?: Date;
  contextId: string;
  createdAt?: Date;
  evidenceCount?: number;
  id?: string;
  isPrimary?: boolean;
  metadata?: Record<string, unknown> | null;
  projectId: string;
  source: UserMemoryContextProjectSource;
  updatedAt?: Date;
  userId?: string | null;
}

/** Row of `user_memories_activities` — evidence: something that happened in one conversation. */
export interface UserMemoryActivity {
  accessedAt: Date;
  associatedLocations: { address?: string; name?: string; tags?: string[]; type?: string }[] | null;
  associatedObjects: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  associatedSubjects: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  capturedAt: Date;
  createdAt: Date;
  dossierId: string | null;
  endsAt: Date | null;
  feedback: string | null;
  feedbackVector: number[] | null;
  id: string;
  injectable: boolean;
  metadata: Record<string, unknown> | null;
  narrative: string | null;
  narrativeVector: number[] | null;
  notes: string | null;
  startsAt: Date | null;
  status: string;
  tags: string[] | null;
  timezone: string | null;
  type: string;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryActivity`: required columns have no database default. */
export interface UserMemoryActivityInsert {
  accessedAt?: Date;
  associatedLocations?:
    { address?: string; name?: string; tags?: string[]; type?: string }[] | null;
  associatedObjects?: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  associatedSubjects?: { extra?: Record<string, unknown>; name?: string; type?: string }[] | null;
  capturedAt?: Date;
  createdAt?: Date;
  dossierId?: string | null;
  endsAt?: Date | null;
  feedback?: string | null;
  feedbackVector?: number[] | null;
  id?: string;
  injectable?: boolean;
  metadata?: Record<string, unknown> | null;
  narrative?: string | null;
  narrativeVector?: number[] | null;
  notes?: string | null;
  startsAt?: Date | null;
  status?: string;
  tags?: string[] | null;
  timezone?: string | null;
  type: string;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_identities` — a fact about an entity. */
export interface UserMemoryIdentity {
  accessedAt: Date;
  capturedAt: Date;
  createdAt: Date;
  description: string | null;
  descriptionVector: number[] | null;
  entityId: string | null;
  episodicDate: Date | null;
  id: string;
  metadata: Record<string, unknown> | null;
  relationship: string | null;
  role: string | null;
  tags: string[] | null;
  type: string | null;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryIdentity`: required columns have no database default. */
export interface UserMemoryIdentityInsert {
  accessedAt?: Date;
  capturedAt?: Date;
  createdAt?: Date;
  description?: string | null;
  descriptionVector?: number[] | null;
  entityId?: string | null;
  episodicDate?: Date | null;
  id?: string;
  metadata?: Record<string, unknown> | null;
  relationship?: string | null;
  role?: string | null;
  tags?: string[] | null;
  type?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_preferences` — a preference held by the user or another entity. */
export interface UserMemoryPreference {
  accessedAt: Date;
  appliesToEntityId: string | null;
  capturedAt: Date;
  conclusionDirectives: string | null;
  conclusionDirectivesVector: number[] | null;
  createdAt: Date;
  evidenceCount: number;
  evidenceSource: UserMemoryEvidenceSource | null;
  holderEntityId: string | null;
  id: string;
  lastEvidenceAt: Date | null;
  metadata: Record<string, unknown> | null;
  scope: string | null;
  scorePriority: number | null;
  suggestions: string | null;
  tags: string[] | null;
  type: string | null;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryPreference`: required columns have no database default. */
export interface UserMemoryPreferenceInsert {
  accessedAt?: Date;
  appliesToEntityId?: string | null;
  capturedAt?: Date;
  conclusionDirectives?: string | null;
  conclusionDirectivesVector?: number[] | null;
  createdAt?: Date;
  evidenceCount?: number;
  evidenceSource?: UserMemoryEvidenceSource | null;
  holderEntityId?: string | null;
  id?: string;
  lastEvidenceAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  scope?: string | null;
  scorePriority?: number | null;
  suggestions?: string | null;
  tags?: string[] | null;
  type?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_experiences` (deprecated layer). */
export interface UserMemoryExperience {
  accessedAt: Date;
  action: string | null;
  actionVector: number[] | null;
  capturedAt: Date;
  createdAt: Date;
  id: string;
  keyLearning: string | null;
  keyLearningVector: number[] | null;
  metadata: Record<string, unknown> | null;
  possibleOutcome: string | null;
  reasoning: string | null;
  scoreConfidence: number | null;
  situation: string | null;
  situationVector: number[] | null;
  tags: string[] | null;
  type: string | null;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryExperience`: required columns have no database default. */
export interface UserMemoryExperienceInsert {
  accessedAt?: Date;
  action?: string | null;
  actionVector?: number[] | null;
  capturedAt?: Date;
  createdAt?: Date;
  id?: string;
  keyLearning?: string | null;
  keyLearningVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  possibleOutcome?: string | null;
  reasoning?: string | null;
  scoreConfidence?: number | null;
  situation?: string | null;
  situationVector?: number[] | null;
  tags?: string[] | null;
  type?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_entities` — a person, organization, product, repository or place. */
export interface UserMemoryEntity {
  accessedAt: Date;
  createdAt: Date;
  description: string | null;
  descriptionVector: number[] | null;
  id: string;
  isSelf: boolean;
  metadata: Record<string, unknown> | null;
  name: string;
  parentEntityId: string | null;
  relationship: string | null;
  role: string | null;
  type: UserMemoryEntityType;
  updatedAt: Date;
  userId: string | null;
  userMemoryId: string | null;
}

/** Insert shape of `UserMemoryEntity`: required columns have no database default. */
export interface UserMemoryEntityInsert {
  accessedAt?: Date;
  createdAt?: Date;
  description?: string | null;
  descriptionVector?: number[] | null;
  id?: string;
  isSelf?: boolean;
  metadata?: Record<string, unknown> | null;
  name: string;
  parentEntityId?: string | null;
  relationship?: string | null;
  role?: string | null;
  type?: UserMemoryEntityType;
  updatedAt?: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

/** Row of `user_memories_entity_names` — a name an entity goes by. */
export interface UserMemoryEntityName {
  accessedAt: Date;
  createdAt: Date;
  entityId: string;
  id: string;
  kind: UserMemoryEntityNameKind;
  metadata: Record<string, unknown> | null;
  name: string;
  normalized: string;
  sourceMemoryId: string | null;
  updatedAt: Date;
  userId: string | null;
}

/** Insert shape of `UserMemoryEntityName`: required columns have no database default. */
export interface UserMemoryEntityNameInsert {
  accessedAt?: Date;
  createdAt?: Date;
  entityId: string;
  id?: string;
  kind?: UserMemoryEntityNameKind;
  metadata?: Record<string, unknown> | null;
  name: string;
  normalized: string;
  sourceMemoryId?: string | null;
  updatedAt?: Date;
  userId?: string | null;
}

/** Row of `user_memories_edges` — a graph relation between two memories. */
export interface UserMemoryEdge {
  accessedAt: Date;
  createdAt: Date;
  evidenceCount: number;
  id: string;
  metadata: Record<string, unknown> | null;
  relation: UserMemoryEdgeRelation;
  sourceMemoryId: string;
  targetMemoryId: string;
  updatedAt: Date;
  userId: string | null;
}

/** Insert shape of `UserMemoryEdge`: required columns have no database default. */
export interface UserMemoryEdgeInsert {
  accessedAt?: Date;
  createdAt?: Date;
  evidenceCount?: number;
  id?: string;
  metadata?: Record<string, unknown> | null;
  relation: UserMemoryEdgeRelation;
  sourceMemoryId: string;
  targetMemoryId: string;
  updatedAt?: Date;
  userId?: string | null;
}

/** Row of `user_memories_operations` — one structural change, with what is needed to undo it. */
export interface UserMemoryOperation {
  accessedAt: Date;
  actor: UserMemoryOperationActor;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  confidence: number | null;
  createdAt: Date;
  gate: UserMemoryOperationGate;
  id: string;
  metadata: Record<string, unknown> | null;
  op: UserMemoryOperationType;
  reason: string | null;
  resolvedAt: Date | null;
  state: UserMemoryOperationState;
  targets: Record<string, string | string[]>;
  updatedAt: Date;
  userId: string | null;
}

/** Insert shape of `UserMemoryOperation`: required columns have no database default. */
export interface UserMemoryOperationInsert {
  accessedAt?: Date;
  actor: UserMemoryOperationActor;
  after?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  confidence?: number | null;
  createdAt?: Date;
  gate: UserMemoryOperationGate;
  id?: string;
  metadata?: Record<string, unknown> | null;
  op: UserMemoryOperationType;
  reason?: string | null;
  resolvedAt?: Date | null;
  state: UserMemoryOperationState;
  targets: Record<string, string | string[]>;
  updatedAt?: Date;
  userId?: string | null;
}

/** Row of `user_memory_persona_documents` — the current persona of a user. */
export interface UserPersonaDocument {
  accessedAt: Date;
  capturedAt: Date;
  createdAt: Date;
  id: string;
  memoryIds: string[] | null;
  metadata: Record<string, unknown> | null;
  persona: string | null;
  profile: string;
  sourceIds: string[] | null;
  tagline: string | null;
  updatedAt: Date;
  userId: string | null;
  version: number;
}

/** Insert shape of `UserPersonaDocument`: required columns have no database default. */
export interface UserPersonaDocumentInsert {
  accessedAt?: Date;
  capturedAt?: Date;
  createdAt?: Date;
  id?: string;
  memoryIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  persona?: string | null;
  profile?: string;
  sourceIds?: string[] | null;
  tagline?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  version?: number;
}

/** Row of `user_memory_persona_document_histories` — one persona revision. */
export interface UserPersonaDocumentHistory {
  accessedAt: Date;
  capturedAt: Date;
  createdAt: Date;
  diffPersona: string | null;
  diffTagline: string | null;
  editedBy: string | null;
  id: string;
  memoryIds: string[] | null;
  metadata: Record<string, unknown> | null;
  nextVersion: number | null;
  personaId: string | null;
  previousVersion: number | null;
  profile: string;
  reasoning: string | null;
  snapshot: string | null;
  snapshotPersona: string | null;
  snapshotTagline: string | null;
  sourceIds: string[] | null;
  summary: string | null;
  updatedAt: Date;
  userId: string | null;
}

/** Insert shape of `UserPersonaDocumentHistory`: required columns have no database default. */
export interface UserPersonaDocumentHistoryInsert {
  accessedAt?: Date;
  capturedAt?: Date;
  createdAt?: Date;
  diffPersona?: string | null;
  diffTagline?: string | null;
  editedBy?: string | null;
  id?: string;
  memoryIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  nextVersion?: number | null;
  personaId?: string | null;
  previousVersion?: number | null;
  profile?: string;
  reasoning?: string | null;
  snapshot?: string | null;
  snapshotPersona?: string | null;
  snapshotTagline?: string | null;
  sourceIds?: string[] | null;
  summary?: string | null;
  updatedAt?: Date;
  userId?: string | null;
}
