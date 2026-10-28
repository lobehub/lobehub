import { TRPCError } from '@trpc/server';

import { validateHeteroOperationClaims } from '../../utils/internalJwt';
import type { OIDCAuth } from '../context';

/**
 * Routes a Task run's operation token may call to file evidence into its own
 * verification round: what `lh acceptance run result submit --operation` and
 * `lh acceptance run ingest --operation` reach on the plan-round path.
 *
 * The round is owned by the operation's creator. On a device logged in as
 * another member the token is the only identity that can reach it, so without
 * these routes the run can produce evidence but never hand it in.
 *
 * The `verify.*` routes bind every read and write to `heteroOperationScope`,
 * and `submitCheckEvidence` takes evidence only: the verdict and the rest of
 * the result belong to the round's verifier. `upload.createS3PreSignedUrl`
 * signs only a sized, reserved PUT under a content-addressed key.
 * `file.createFile` files what this token uploads as private acceptance
 * evidence, kept out of the creator's library, folders and knowledge bases, and
 * `user.getUserState` (the report-language check) returns only the response
 * language to it. Every other route keeps rejecting the token.
 */
export const HETERO_OPERATION_EVIDENCE_PATHS: ReadonlySet<string> = new Set([
  'file.checkFileHash',
  'file.createFile',
  'upload.abortS3Upload',
  'upload.createS3PreSignedUrl',
  'user.getUserState',
  'verify.getRun',
  'verify.getVerifyState',
  'verify.listResults',
  'verify.submitCheckEvidence',
  'verify.uploadEvidence',
]);

const reject = (message = 'hetero-operation tokens are not accepted on this endpoint') =>
  new TRPCError({ code: 'UNAUTHORIZED', message });

/**
 * Let a `hetero-operation` token through to an evidence route, or throw.
 *
 * The token must carry `acceptance:evidence`, stay in the workspace it was
 * minted for, and belong to a run that is still going under a principal that
 * is still authorized — the same re-check every other operation endpoint makes.
 */
export const authorizeHeteroOperationEvidence = async (params: {
  oidcAuth: OIDCAuth;
  path: string;
  workspaceId?: string | null;
}) => {
  const { oidcAuth, path, workspaceId } = params;
  if (!HETERO_OPERATION_EVIDENCE_PATHS.has(path)) throw reject();

  const claims = validateHeteroOperationClaims(oidcAuth as Record<string, unknown>);
  if (!claims?.capabilities.includes('acceptance:evidence')) throw reject();
  // A header naming another workspace must not move the token out of its own.
  if (workspaceId && workspaceId !== claims.workspace_id) {
    throw reject('Operation token is bound to another workspace');
  }

  // Loaded only once an operation token reaches an evidence route: `oidcAuth`
  // sits in front of every authed router, and a static import would pull the
  // workspace and RBAC models into each of them at module load.
  const [
    { getServerDB },
    { HeteroOperationPrincipalError, resolveActiveHeteroOperationPrincipal },
  ] = await Promise.all([
    import('@/database/core/db-adaptor'),
    import('@/server/services/heterogeneousAgent/operationPrincipal'),
  ]);

  try {
    const principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'acceptance:evidence',
      claims,
      db: await getServerDB(),
      operationId: claims.operation_id,
    });
    return {
      heteroOperationScope: principal.operationId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    };
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
};
