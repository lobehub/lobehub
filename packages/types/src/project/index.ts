export const PROJECT_IDENTIFIER_REGEX = /^[A-Z][A-Z0-9]{2,5}$/;

/**
 * Ids the create form reserves for a new project and its dedicated main agent,
 * in the shape the server would generate them (`idGenerator`). Their generated
 * avatars are seeded by id, so reserving the ids up front lets the form show
 * the exact avatars the project and its agent keep after creation.
 */
export const PROJECT_ID_REGEX = /^prj_[\dA-Za-z]{12}$/;

export const PROJECT_AGENT_ID_REGEX = /^agt_[\dA-Za-z]{12}$/;

/**
 * `CONFLICT` messages for a taken project slug or identifier.
 *
 * The create router sends one of these as the tRPC error message, so a form can
 * tell which field the conflict belongs to and mark that input instead of
 * showing a generic failure.
 */
export const PROJECT_DUPLICATE_IDENTIFIER = 'DUPLICATE_PROJECT_IDENTIFIER';

export const PROJECT_DUPLICATE_SLUG = 'DUPLICATE_PROJECT_SLUG';

/** The field a person edits to resolve a duplicate project value. */
export type ProjectDuplicateField = 'identifier' | 'slug';

export const PROJECT_STATUSES = [
  'backlog',
  'active',
  'paused',
  'reviewing',
  'completed',
  'canceled',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_VISIBILITIES = ['private', 'public'] as const;

export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const PROJECT_WORKING_DIRECTORY_PERMISSIONS = ['readOnly', 'readWrite'] as const;

export type ProjectWorkingDirectoryPermission =
  (typeof PROJECT_WORKING_DIRECTORY_PERMISSIONS)[number];

export const PROJECT_COMPLETION_DECISIONS = ['accepted', 'rejected'] as const;

export type ProjectCompletionDecision = (typeof PROJECT_COMPLETION_DECISIONS)[number];

/**
 * How the one-off coordinator ownership migration settled a project's main agent:
 * - `owned` — provisioned for this project and used by no other; marked as the
 *   project's own (`agents.owner_project_id`), so the project is its only entry.
 * - `shared` — a provisioned agent another project also leads or seats; left
 *   unmarked so no project hides an agent the others still depend on.
 * - `builtin` — LobeAI (inbox) or another builtin agent; never marked.
 * - `user_picked` — an agent the user made and chose; left unmarked and visible.
 * - `fallback_null` — no coordinator stored; readers fall back to LobeAI.
 */
export const PROJECT_COORDINATOR_OWNERSHIP_DECISIONS = [
  'owned',
  'shared',
  'builtin',
  'user_picked',
  'fallback_null',
] as const;

export type ProjectCoordinatorOwnershipDecision =
  (typeof PROJECT_COORDINATOR_OWNERSHIP_DECISIONS)[number];

/**
 * Where a project's coordinator configuration lives, as the project settings
 * read it: the project's own agent (`owned`), or an agent it only links to.
 */
export type ProjectCoordinatorSource = 'owned' | 'shared' | 'builtin' | 'user_picked';

/** A coordinator's bot connection, without credentials. */
export interface ProjectCoordinatorBotProviderSnapshot {
  applicationId: string;
  enabled: boolean;
  platform: string;
  settings: Record<string, unknown> | null;
}

/**
 * The coordinator configuration a project carries: the fields the project
 * settings page edits, captured verbatim from the agent row (and its bot
 * connections) the project owns or links to.
 */
export interface ProjectCoordinatorConfigSnapshot {
  agencyConfig: unknown;
  avatar: string | null;
  botProviders: ProjectCoordinatorBotProviderSnapshot[];
  chatConfig: unknown;
  description: string | null;
  model: string | null;
  openingMessage: string | null;
  openingQuestions: string[] | null;
  params: unknown;
  plugins: string[] | null;
  provider: string | null;
  systemRole: string | null;
  title: string | null;
  tts: unknown;
  virtual: boolean | null;
}

export const PROJECT_MEMBER_ROLES = ['viewer', 'member', 'admin'] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];
