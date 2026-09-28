import { maskSecret, pickAuthSource } from '../../auth/source';
import { CLI_API_KEY_ENV } from '../../constants/auth';
import { CLI_PRIMARY_BIN } from '../../constants/identity';
import { probeCredential, probeServerVersion } from '../probes';
import type { CheckOutcome, DoctorCheck } from '../types';

/**
 * Which credential wins — asked and answered before anything tries to use it.
 *
 * A `LOBEHUB_JWT` inherited from a parent agent run silently outranks the login
 * the user is thinking of, and that mismatch reads downstream as "the server
 * lost my data" rather than "you are a different principal than you assume".
 */
const credentialSource: DoctorCheck = {
  group: 'credentials',
  id: 'credentials.source',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const source = pickAuthSource();
    const evidence = {
      kind: source.kind,
      origin: source.origin,
      token: maskSecret(source.token),
      tokenType: source.tokenType,
    };

    if (!source.token)
      return {
        detail: 'No credential anywhere: no login on disk, no API key in the environment.',
        evidence,
        fix: `Run '${CLI_PRIMARY_BIN} login', or set ${CLI_API_KEY_ENV}.`,
        status: 'fail',
      };

    if (source.kind === 'env-jwt')
      return {
        detail: `Authenticating with the LOBEHUB_JWT in this environment (${maskSecret(source.token)}), not with the stored login.`,
        evidence,
        fix: 'Expected? This is how server-dispatched runs authenticate. If not, unset LOBEHUB_JWT.',
        status: 'warn',
      };

    return {
      detail: `Using ${source.origin} (${maskSecret(source.token)}).`,
      evidence,
      status: 'ok',
    };
  },
  title: 'credential source',
};

const credentialValidity: DoctorCheck = {
  dependsOn: ['credentials.source', 'endpoints.reachable'],
  group: 'credentials',
  id: 'credentials.validity',
  network: true,
  profiles: ['core'],
  run: async (ctx): Promise<CheckOutcome> => {
    const credential = await probeCredential(ctx);
    const expiresInSeconds = credential.expiresAt
      ? credential.expiresAt - Date.now() / 1000
      : undefined;
    const evidence = {
      expiresAt: credential.expiresAt
        ? new Date(credential.expiresAt * 1000).toISOString()
        : undefined,
      kind: credential.kind,
      tokenType: credential.tokenType,
      userId: credential.userId,
    };

    if (credential.error)
      return {
        // The probe's reasons are whole sentences, so the trailing period has to give way rather
        // than double up behind them.
        detail: `${credential.origin} cannot be used: ${credential.error.replace(/\.$/, '')}.`,
        evidence,
        // The probe's own remedy wins: a refresh that never got an answer needs a retry, and
        // printing the generic "log in again" under that diagnosis contradicts it.
        fix:
          credential.fix ??
          (credential.kind === 'env-api-key'
            ? `Issue a fresh key and re-export ${CLI_API_KEY_ENV}.`
            : `Run '${CLI_PRIMARY_BIN} login' again.`),
        status: 'fail',
      };

    if (!credential.userId)
      return {
        detail: `${credential.origin} carries no readable subject, so no account can be derived from it.`,
        evidence,
        fix:
          credential.tokenType === 'apiKey'
            ? 'Expected for API keys; set LOBEHUB_WORKSPACE_ID explicitly if you need workspace scope.'
            : `Run '${CLI_PRIMARY_BIN} login' again.`,
        status: credential.tokenType === 'apiKey' ? 'ok' : 'fail',
      };

    if (expiresInSeconds !== undefined && expiresInSeconds < 0)
      return {
        detail: `The token for ${credential.userId} expired ${Math.round(-expiresInSeconds / 60)} minutes ago and did not refresh.`,
        evidence,
        fix: `Run '${CLI_PRIMARY_BIN} login' again.`,
        status: 'fail',
      };

    if (expiresInSeconds !== undefined && expiresInSeconds < 300)
      return {
        detail: `Valid for ${credential.userId}, but expires in ${Math.round(expiresInSeconds / 60)} minutes.`,
        evidence,
        fix: 'A long-running command may outlive it; refresh now with a fresh login.',
        status: 'warn',
      };

    return {
      detail: `Valid for ${credential.userId} via ${credential.origin}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'credential validity',
};

/**
 * Clock skew breaks token validation with errors that name neither the clock
 * nor the token — they come back as plain 401s from JWKS verification.
 */
const clockSkew: DoctorCheck = {
  dependsOn: ['endpoints.reachable'],
  group: 'credentials',
  id: 'credentials.clock',
  network: true,
  profiles: ['core'],
  run: async (ctx): Promise<CheckOutcome> => {
    const probe = await probeServerVersion(ctx);
    if (!probe.dateHeader)
      return { detail: 'The server did not send a Date header; skew is unknown.', status: 'ok' };

    // The header is stamped when the response leaves; half the round trip is
    // the fairest correction available without a dedicated time endpoint.
    const serverTime = new Date(probe.dateHeader).getTime();
    const skewMs = Math.abs(Date.now() - probe.latencyMs / 2 - serverTime);
    const evidence = {
      latencyMs: probe.latencyMs,
      serverTime: probe.dateHeader,
      skewSeconds: Math.round(skewMs / 1000),
    };

    if (skewMs > 300_000)
      return {
        detail: `This machine's clock is ${Math.round(skewMs / 1000)}s away from the server's.`,
        evidence,
        fix: 'Enable network time sync — token validation fails as a plain 401 at this much skew.',
        status: 'fail',
      };

    if (skewMs > 60_000)
      return {
        detail: `Clock differs from the server by ${Math.round(skewMs / 1000)}s.`,
        evidence,
        fix: 'Enable network time sync before it grows.',
        status: 'warn',
      };

    return {
      detail: `Clock is within ${Math.round(skewMs / 1000)}s of the server.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'clock skew',
};

export const credentialChecks: readonly DoctorCheck[] = [
  credentialSource,
  credentialValidity,
  clockSkew,
];
