import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { rethrowDuplicateProjectField } from './projectConstraintErrors';

// Drizzle wraps the driver error, so the Postgres fields sit down the cause chain.
const driverError = (code: string, constraint: string) =>
  Object.assign(new Error('Failed query: insert into "projects" ...'), {
    cause: { code, constraint },
  });

describe('rethrowDuplicateProjectField', () => {
  it.each([
    ['projects_slug_user_id_unique', 'DUPLICATE_PROJECT_SLUG'],
    ['projects_slug_workspace_id_unique', 'DUPLICATE_PROJECT_SLUG'],
    ['projects_identifier_user_id_unique', 'DUPLICATE_PROJECT_IDENTIFIER'],
    ['projects_identifier_workspace_id_unique', 'DUPLICATE_PROJECT_IDENTIFIER'],
  ])('maps %s to %s', (constraint, message) => {
    expect(() => rethrowDuplicateProjectField(driverError('23505', constraint))).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message }),
    );
  });

  it('rethrows anything else untouched', () => {
    const other = driverError('23505', 'environments_user_name_unique');
    expect(() => rethrowDuplicateProjectField(other)).toThrow(other);
    const notUnique = driverError('23503', 'projects_slug_user_id_unique');
    expect(() => rethrowDuplicateProjectField(notUnique)).toThrow(notUnique);
    expect(() => rethrowDuplicateProjectField(new Error('x'))).not.toThrow(TRPCError);
  });
});
