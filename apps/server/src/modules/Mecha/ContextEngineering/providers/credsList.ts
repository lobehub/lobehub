import { type CredSummary, generateCredsList } from '@lobechat/builtin-tool-creds';

import { UserModel } from '@/database/models/user';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';
import { MarketService } from '@/server/services/market';

import type { ServerContextFactInput } from './types';

/**
 * `{{CREDS_LIST}}` — the credentials the model may inject into a sandbox.
 * Inside a workspace, the agent must only see the workspace's shared
 * organization credentials — personal creds are not visible there.
 */
export const resolveCredsListVariable = async ({
  ctx,
}: ServerContextFactInput): Promise<string> => {
  if (!ctx.userId) return '';
  try {
    // Read market accessToken from DB so the server-side runtime can
    // authenticate with the Market API instead of falling back to an
    // anonymous trustedClientToken (which 401s on creds endpoints).
    let marketAccessToken: string | undefined;
    if (ctx.serverDB) {
      try {
        const settings = await new UserModel(ctx.serverDB, ctx.userId).getUserSettings();
        marketAccessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService will fall back to trustedClientToken
      }
    }

    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: ctx.userId },
    });
    const credsResult = ctx.workspaceId
      ? await marketService.market.organizations.creds({ workspaceId: ctx.workspaceId }).list()
      : await marketService.market.creds.list();
    const userCreds = (credsResult as any)?.data ?? [];
    log('Fetched %d creds for {{CREDS_LIST}} substitution', userCreds.length);
    return generateCredsList(
      userCreds.map((cred: any): CredSummary => ({
        description: cred.description,
        key: cred.key,
        name: cred.name,
        ownerDisplayName: cred.ownerDisplayName,
        ownerType: cred.ownerType,
        type: cred.type,
      })),
    );
  } catch (error) {
    log('Failed to fetch creds for {{CREDS_LIST}} substitution: %O', error);
    return '';
  }
};
