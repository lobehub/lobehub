import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';

/**
 * Where the effective workspace of a request came from:
 * - `apiKey`: a workspace API key, which binds every call to its own workspace
 *   regardless of `X-Workspace-Id`;
 * - `header`: a session/OIDC request scoped by `X-Workspace-Id`;
 * - `personal`: no workspace is in effect.
 */
export type CredentialScopeSource = 'apiKey' | 'header' | 'personal';

export interface CredentialScope {
  scope: 'personal' | 'workspace';
  source: CredentialScopeSource;
  workspaceId: string | null;
}

export const authRouter = router({
  /**
   * The workspace scope the presented credential actually runs under, so a
   * client (e.g. `lh whoami`) reports it instead of guessing it locally.
   *
   * Runs behind `wsCompatProcedure`, the same middleware chain as the content
   * routers: the cloud `cloudWorkspaceAuth` demotes a header naming a workspace
   * the caller is not a member of to personal mode, and this reports the scope
   * left after that — not the raw header.
   */
  getScope: wsCompatProcedure.query(({ ctx }): CredentialScope => {
    const workspaceId = ctx.workspaceId ?? null;

    if (!workspaceId) return { scope: 'personal', source: 'personal', workspaceId: null };

    // `apiKeyScopes` is set (a list, or `null` for full access) only when the
    // request authenticated with an API key; `createLambdaContext` then pins
    // `workspaceId` to the key's own workspace.
    const source = ctx.apiKeyScopes !== undefined ? 'apiKey' : 'header';

    return { scope: 'workspace', source, workspaceId };
  }),
});
