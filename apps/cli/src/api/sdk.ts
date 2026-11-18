import type { ThrowingLobeHubClient } from '@lobehub/sdk';
import { createLobeHub } from '@lobehub/sdk';

import { describeTokenLookup, getValidToken } from '../auth/refresh';
import { pickAuthSource } from '../auth/source';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { cliPackageName } from '../pkg';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { isOperationToken, storedLoginFor } from './operationTokenFallback';
import { resolveWorkspaceId } from './workspace';

export type SdkClient = ThrowingLobeHubClient;

const PERSONAL_KEY = '__personal__';
const _clients = new Map<string, SdkClient>();

type Credential = { accessToken: () => Promise<string> } | { apiKey: string };

/**
 * The credential for `/api/v1/*`, in the same precedence as the tRPC client
 * (`pickAuthSource`). The REST API takes OIDC JWTs and API keys as `Bearer`,
 * but refuses a run's `hetero-operation` token outright: that one is swapped
 * for this machine's stored login of the same account, the rule
 * `operationTokenFallbackLink` applies to tRPC.
 */
async function resolveCredential(): Promise<Credential> {
  const source = pickAuthSource();

  if (source.kind === 'env-jwt') {
    // Read per request: `hetero exec` renews its token in place.
    const envToken = () => process.env.LOBEHUB_JWT || source.token!;
    if (!isOperationToken(source.token)) return { accessToken: async () => envToken() };

    return {
      accessToken: async () => {
        const lookup = await storedLoginFor(envToken());
        if ('token' in lookup) return lookup.token;
        throw new Error(lookup.warning);
      },
    };
  }

  if (source.kind === 'env-api-key') return { apiKey: source.token! };

  const result = await getValidToken();
  if (result.status !== 'ok') {
    const report = describeTokenLookup(result);
    log.error(
      report
        ? `${report.detail} ${report.fix}`
        : `No authentication found. Run '${CLI_PRIMARY_BIN} login' (or 'npx -y ${cliPackageName} login') first, or set ${CLI_API_KEY_ENV}.`,
    );
    process.exit(1);
  }

  return {
    // Cached clients outlive access tokens: resolve the stored login per request.
    accessToken: async () => {
      const current = await getValidToken();
      if (current.status !== 'ok') {
        const report = describeTokenLookup(current);
        throw new Error(report ? `${report.detail} ${report.fix}` : 'No authentication found');
      }
      return current.credentials.accessToken;
    },
  };
}

/**
 * A `@lobehub/sdk` client for the public REST API (`/api/v1/*`), scoped like
 * every other command: explicit id → `LOBEHUB_WORKSPACE_ID` → `lh workspace
 * use` → personal. Methods throw `LobeHubAPIError` on an error answer.
 */
export async function getSdkClient(workspaceId?: string): Promise<SdkClient> {
  const wsId = resolveWorkspaceId(workspaceId);
  const cacheKey = wsId ?? PERSONAL_KEY;
  const cached = _clients.get(cacheKey);
  if (cached) return cached;

  const client = createLobeHub({
    ...(await resolveCredential()),
    baseURL: resolveServerUrl(),
    // Late-bound so a stubbed global fetch (tests, proxies) is honoured.
    fetch: (...args) => globalThis.fetch(...args),
    throwOnError: true,
    workspaceId: wsId,
  });
  _clients.set(cacheKey, client);

  return client;
}

/** Test seam: drop cached clients so the next call re-resolves credentials. */
export function __resetSdkClients(): void {
  _clients.clear();
}
