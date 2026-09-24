import { createLambdaClient, type TrpcClient } from '../api/client';
import { resolveWorkspaceScope } from '../api/workspace';
import { getUserIdFromApiKey } from '../auth/apiKey';
import { describeTokenLookup, getValidToken } from '../auth/refresh';
import type { AuthSourceKind } from '../auth/source';
import { parseJwtPayload, pickAuthSource } from '../auth/source';
import { resolveServerUrl } from '../settings';
import type { DoctorContext } from './types';

/**
 * Shared loaders. Each is memoized per `lh doctor` run through `ctx.probe`, so
 * the six checks that need "who am I" or "what does the server say" cost one
 * request between them, and every one of them sees the same answer.
 */

export interface ServerVersionProbe {
  /** The server's own clock, from the response `Date` header. */
  dateHeader?: string;
  latencyMs: number;
  serverUrl: string;
  statusCode: number;
  version?: string;
}

export async function probeServerVersion(ctx: DoctorContext): Promise<ServerVersionProbe> {
  return ctx.probe('server:version', async () => {
    const serverUrl = resolveServerUrl();
    const startedAt = Date.now();
    const response = await fetch(`${serverUrl}/api/version`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;

    let version: string | undefined;
    try {
      const body = (await response.json()) as { version?: string };
      version = body.version;
    } catch {
      // A reachable endpoint that isn't JSON is still a reachability signal.
    }

    return {
      dateHeader: response.headers.get('date') ?? undefined,
      latencyMs,
      serverUrl,
      statusCode: response.status,
      version,
    };
  });
}

export interface CredentialProbe {
  /** Why the credential could not be used, when it could not. */
  error?: string;
  /** `exp` claim, for JWTs. */
  expiresAt?: number;
  /**
   * The remedy for that failure, when the probe knows one more specific than "log in again" —
   * a refresh that timed out needs a retry, not a re-authentication.
   */
  fix?: string;
  kind: AuthSourceKind;
  origin: string;
  serverUrl: string;
  token?: string;
  tokenType: 'apiKey' | 'jwt' | 'serviceToken';
  userId?: string;
}

/**
 * Resolve the live credential the way a real command would — refreshing a
 * stored token, validating an API key against the server — but reporting
 * failure instead of exiting, because "no usable credential" is an answer
 * doctor has to print rather than die on.
 */
export async function probeCredential(ctx: DoctorContext): Promise<CredentialProbe> {
  return ctx.probe('auth:credential', async () => {
    const source = pickAuthSource();
    const serverUrl = resolveServerUrl();
    const base = {
      kind: source.kind,
      origin: source.origin,
      serverUrl,
      tokenType: source.tokenType,
    };

    if (source.kind === 'env-api-key') {
      try {
        const userId = await getUserIdFromApiKey(source.token!, serverUrl);
        return { ...base, token: source.token, userId };
      } catch (error) {
        return { ...base, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (source.kind === 'stored') {
      const refreshed = await getValidToken();
      if (refreshed.status !== 'ok') {
        const report = describeTokenLookup(refreshed);

        return {
          ...base,
          error:
            report?.detail ??
            (source.token
              ? 'the stored token has expired and could not be refreshed'
              : 'no stored login on this machine'),
          fix: report?.fix,
        };
      }
      const payload = parseJwtPayload(refreshed.credentials.accessToken);
      return {
        ...base,
        expiresAt: typeof payload?.exp === 'number' ? payload.exp : undefined,
        token: refreshed.credentials.accessToken,
        userId: typeof payload?.sub === 'string' ? payload.sub : undefined,
      };
    }

    const payload = source.token ? parseJwtPayload(source.token) : undefined;
    return {
      ...base,
      expiresAt: typeof payload?.exp === 'number' ? payload.exp : undefined,
      token: source.token,
      userId: typeof payload?.sub === 'string' ? payload.sub : undefined,
    };
  });
}

/**
 * A tRPC client built from the already-probed credential.
 *
 * Deliberately not `getTrpcClient()`: that one re-resolves credentials and
 * exits the process when there are none, which would kill the report right
 * where it gets interesting.
 */
export async function probeClient(ctx: DoctorContext): Promise<TrpcClient> {
  return ctx.probe('api:client', async () => {
    const credential = await probeCredential(ctx);
    if (!credential.token) throw new Error(credential.error ?? 'no usable credential');

    return createLambdaClient(
      {
        serverUrl: credential.serverUrl,
        token: credential.token,
        tokenType: credential.tokenType,
      },
      resolveWorkspaceScope().workspaceId,
    );
  });
}

export async function probeGlobalConfig(ctx: DoctorContext): Promise<any> {
  return ctx.probe('server:globalConfig', async () => {
    const client = await probeClient(ctx);
    return client.config.getGlobalConfig.query();
  });
}

export async function probeDevices(ctx: DoctorContext): Promise<any[]> {
  return ctx.probe('server:devices', async () => {
    const client = await probeClient(ctx);
    const devices = await client.device.listDevices.query();
    return Array.isArray(devices) ? devices : [];
  });
}

export async function probeProviders(ctx: DoctorContext): Promise<any[]> {
  return ctx.probe('server:providers', async () => {
    const client = await probeClient(ctx);
    const providers = await client.aiProvider.getAiProviderList.query();
    return Array.isArray(providers) ? providers : [];
  });
}
