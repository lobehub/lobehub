import { CLI_API_KEY_ENV } from '../constants/auth';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { getUserIdFromApiKey } from './apiKey';
import { getValidToken } from './refresh';
import { pickAuthSource } from './source';

interface ResolveTokenOptions {
  serviceToken?: string;
  token?: string;
  userId?: string;
}

interface ResolvedAuth {
  serverUrl: string;
  token: string;
  tokenType: 'apiKey' | 'jwt' | 'serviceToken';
  userId: string;
}

/**
 * Parse the `sub` claim from a JWT without verifying the signature.
 */
export function parseJwtSub(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.sub;
  } catch {
    return undefined;
  }
}

/**
 * Resolve an access token from explicit options, environment variables, or stored credentials.
 * Exits the process if no token can be resolved.
 *
 * The precedence itself lives in `pickAuthSource` so `lh doctor` can report the
 * winning credential without logging in as it.
 */
export async function resolveToken(options: ResolveTokenOptions): Promise<ResolvedAuth> {
  const source = pickAuthSource(options);

  switch (source.kind) {
    // Used by server-side sandbox execution.
    case 'env-jwt': {
      const serverUrl = resolveServerUrl();
      const userId = parseJwtSub(source.token!);
      if (!userId) {
        log.error('Could not extract userId from LOBEHUB_JWT.');
        process.exit(1);
      }
      log.debug('Using LOBEHUB_JWT from environment');
      return { serverUrl, token: source.token!, tokenType: 'jwt', userId };
    }

    case 'option-token': {
      const userId = parseJwtSub(source.token!);
      if (!userId) {
        log.error('Could not extract userId from token. Provide --user-id explicitly.');
        process.exit(1);
      }
      return { serverUrl: resolveServerUrl(), token: source.token!, tokenType: 'jwt', userId };
    }

    case 'option-service-token': {
      if (!options.userId) {
        log.error('--user-id is required when using --service-token');
        process.exit(1);
      }
      return {
        serverUrl: resolveServerUrl(),
        token: source.token!,
        tokenType: 'serviceToken',
        userId: options.userId!,
      };
    }

    case 'env-api-key': {
      try {
        const serverUrl = resolveServerUrl();
        const userId = await getUserIdFromApiKey(source.token!, serverUrl);
        log.debug(`Using ${source.origin} from environment`);
        return { serverUrl, token: source.token!, tokenType: 'apiKey', userId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Failed to validate ${source.origin}: ${message}`);
        process.exit(1);
      }
    }
  }

  // Stored credentials, refreshed when the access token is close to expiry.
  const result = await getValidToken();
  if (result) {
    log.debug('Using stored credentials');
    const { credentials } = result;
    const serverUrl = resolveServerUrl();

    const userId = parseJwtSub(credentials.accessToken);
    if (!userId) {
      log.error(`Stored token is invalid. Run '${CLI_PRIMARY_BIN} login' again.`);
      process.exit(1);
    }

    return { serverUrl, token: credentials.accessToken, tokenType: 'jwt', userId };
  }

  log.error(
    `No authentication found. Run '${CLI_PRIMARY_BIN} login' first, or set ${CLI_API_KEY_ENV}, or provide --token.`,
  );
  process.exit(1);
}
