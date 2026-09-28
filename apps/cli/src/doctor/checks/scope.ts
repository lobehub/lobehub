import { resolveIdentityFingerprint } from '../../auth/identity';
import { loadActiveWorkspace, resolveServerUrl, saveActiveWorkspace } from '../../settings';
import { redactUrlCredentials } from '../redact';
import type { CheckOutcome, DoctorCheck } from '../types';

/**
 * Which tenant this CLI writes into.
 *
 * The failure worth catching is silent: cloud answers an `X-Workspace-Id` the
 * caller has no membership in by falling back to personal scope, so a scope
 * left over from another account (or another server) keeps printing
 * "workspace" while reads and writes land on personal data. Ingests that
 * "disappear" are almost always this.
 */
const workspaceScope: DoctorCheck = {
  group: 'scope',
  id: 'scope.workspace',
  profiles: ['core'],
  repair: (_ctx, result) => {
    // A saved scope that an env var merely overrides for this one run is still
    // the user's valid selection — dropping it would silently move them to
    // personal scope the moment the override goes away.
    if (result.evidence?.repairable !== 'stale')
      throw new Error('the saved workspace scope is valid; only an unusable one is dropped');

    saveActiveWorkspace(null);
    return 'cleared the stale workspace scope; commands now run in personal scope';
  },
  run: (): CheckOutcome => {
    const stored = loadActiveWorkspace();
    const fromEnv = process.env.LOBEHUB_WORKSPACE_ID?.trim();
    const identity = resolveIdentityFingerprint();
    const serverUrl = resolveServerUrl();
    const evidence: Record<string, unknown> = {
      envWorkspaceId: fromEnv,
      // Redacted like every other URL that reaches the report: a self-hosted
      // server behind basic auth carries its credential in the URL itself.
      serverUrl: redactUrlCredentials(serverUrl),
      storedWorkspaceId: stored?.workspaceId,
    };

    if (fromEnv) {
      if (stored && stored.workspaceId !== fromEnv)
        return {
          detail: `LOBEHUB_WORKSPACE_ID=${fromEnv} overrides the saved scope ${stored.workspaceId}.`,
          evidence,
          fix: 'Intentional in a dispatched run; otherwise unset the env var or re-run `lh workspace use`.',
          status: 'warn',
        };

      return { detail: `Workspace ${fromEnv}, from LOBEHUB_WORKSPACE_ID.`, evidence, status: 'ok' };
    }

    // A dispatched run carries its complete scope in env; the persisted scope
    // belongs to whoever sits at this terminal and must not leak into it.
    if (process.env.LOBEHUB_JWT)
      return {
        detail: stored
          ? `Personal scope: LOBEHUB_JWT is set, so the saved scope ${stored.workspaceId} is deliberately ignored.`
          : 'Personal scope (dispatched run).',
        evidence,
        status: 'ok',
      };

    if (!stored)
      return { detail: 'Personal scope — no workspace selected.', evidence, status: 'ok' };

    // An API key carries no readable subject, so `identity` is undefined for a
    // perfectly valid saved scope whenever LOBEHUB_CLI_API_KEY is exported for
    // one command. That is "cannot tell", not "stale" — marking it repairable
    // would let `--fix` delete a selection that is still the user's.
    if (!identity)
      return {
        detail: `The saved scope ${stored.workspaceId} is ignored while the current credentials do not identify an account.`,
        evidence,
        fix: 'Expected under an API key: set LOBEHUB_WORKSPACE_ID to scope these commands.',
        status: 'warn',
      };

    const reason =
      identity !== stored.identity
        ? 'it was saved under a different account'
        : stored.serverUrl !== serverUrl
          ? `it was saved for ${redactUrlCredentials(stored.serverUrl)}`
          : undefined;

    if (reason)
      return {
        detail: `The saved scope ${stored.workspaceId} is being ignored because ${reason}.`,
        evidence: { ...evidence, repairable: 'stale' },
        fix: `Re-select it with 'lh workspace use ${stored.workspaceId}', or re-run with --fix to drop it.`,
        status: 'fail',
      };

    return {
      detail: `Workspace ${stored.workspaceId}, from 'lh workspace use'.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'workspace scope',
};

export const scopeChecks: readonly DoctorCheck[] = [workspaceScope];
