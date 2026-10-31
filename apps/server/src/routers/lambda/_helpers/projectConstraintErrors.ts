import { TRPCError } from '@trpc/server';

import { getPostgresErrorField } from '../sandboxStorage/constraintErrors';

/** Unique indexes on `projects`, by the field a person changes to resolve them. */
const PROJECT_CONSTRAINT_MESSAGES: Record<string, string> = {
  projects_identifier_user_id_unique: 'DUPLICATE_PROJECT_IDENTIFIER',
  projects_identifier_workspace_id_unique: 'DUPLICATE_PROJECT_IDENTIFIER',
  projects_slug_user_id_unique: 'DUPLICATE_PROJECT_SLUG',
  projects_slug_workspace_id_unique: 'DUPLICATE_PROJECT_SLUG',
};

/**
 * A taken slug or identifier is fixed by editing that field, so it arrives as a
 * CONFLICT with a code the form can translate and show next to the field —
 * not as the raw driver message, which quotes the whole insert. Trashed
 * projects still hold their slug and identifier, so this is reachable by
 * re-creating a project that was just deleted.
 */
export const rethrowDuplicateProjectField = (error: unknown): never => {
  const message =
    getPostgresErrorField(error, 'code') === '23505'
      ? PROJECT_CONSTRAINT_MESSAGES[getPostgresErrorField(error, 'constraint') ?? '']
      : undefined;
  if (message) throw new TRPCError({ cause: error, code: 'CONFLICT', message });

  throw error;
};
