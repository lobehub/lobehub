/**
 * Raised when the identifier a caller picked for a project is already claimed
 * in the same ownership scope.
 *
 * `(workspace_id, identifier)` / `(identifier, user_id)` are backed by unique
 * indexes, so a duplicate used to surface as a raw `insert into "projects"`
 * query failure and the create form could only show a generic failure toast.
 * Raising this instead lets the API and the form treat it as a field-level
 * validation problem.
 */
export class ProjectIdentifierTakenError extends Error {
  readonly identifier: string;

  constructor(identifier: string) {
    super(`Project identifier "${identifier}" is already in use in this scope`);
    this.name = 'ProjectIdentifierTakenError';
    this.identifier = identifier;
  }
}

/**
 * Walk the `cause` chain for the Postgres error that actually failed the
 * statement and decide whether it is the project identifier unique index.
 *
 * Drizzle wraps driver errors, so the `code` / `constraint` fields live on a
 * nested cause rather than the error we catch. The identifier indexes are
 * matched by name because the same insert can also trip `projects_slug_*` or
 * `projects_coordinator_agent_id_unique` — reporting those as "identifier
 * taken" would point the caller at the wrong field.
 */
export const isProjectIdentifierConflict = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    const code = typeof candidate.code === 'string' ? candidate.code : '';
    const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : '';
    const message = typeof candidate.message === 'string' ? candidate.message : '';

    if (constraint.startsWith('projects_identifier_')) return true;
    if (code === '23505' && /projects_identifier_|identifier/i.test(message)) return true;

    current = candidate.cause;
  }

  return false;
};

/**
 * Normalize a project identifier and enforce its shape. Shared with
 * `ProjectRepository.create`, which needs the normalized value to check the
 * scope before it writes the main agent.
 */
export const normalizeProjectIdentifier = (identifier?: string | null) => {
  const normalized = identifier?.trim().toUpperCase() || null;
  if (normalized && (normalized.length < 3 || normalized.length > 6)) {
    throw new Error('Project identifier must be between 3 and 6 characters');
  }
  return normalized;
};
