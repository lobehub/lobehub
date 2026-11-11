import {
  APP_HANDOFF_LOCAL_RATE_LIMIT,
  type AppHandoffCodeRequest,
  type AppHandoffCodeResponse,
  AppHandoffError,
  type AppHandoffErrorCode,
  type AppHandoffStatusResponse,
  normalizeIssuer,
  parseCodeRequest,
} from './protocol';
import type { AppHandoffHttpRequest } from './server';
import type { AppHandoffVerification } from './verifyExecutable';

export const NATIVE_HANDOFF_SERVER_PATH = '/oidc/handoff/native';

export interface DesktopSession {
  /** A currently valid access token of the desktop app's own client. */
  accessToken: string;
  serverUrl: string;
}

export interface HandoffTarget {
  client_id: string;
  name: string;
  verification: AppHandoffVerification;
}

export interface HandoffTargets {
  issuer: string;
  sub: string;
  targets: HandoffTarget[];
}

export interface PeerInfo {
  exePath?: string;
  pid?: number;
  sameUser: boolean;
}

export interface ListenerInfo {
  pid?: number;
  sameUser: boolean;
}

export interface ConfirmRequest {
  appName: string;
  exePath?: string;
  /** False for a deep link: the caller cannot be identified, so "always allow" is not offered. */
  rememberable: boolean;
}

export interface AppHandoffServiceDeps {
  confirm: (request: ConfirmRequest) => Promise<{ allowed: boolean; remember: boolean }>;
  fetch: typeof globalThis.fetch;
  findListener: (port: number) => Promise<ListenerInfo | undefined>;
  findPeer: (serverPort: number, remotePort: number) => Promise<PeerInfo | undefined>;
  /**
   * Resolves the desktop session. With `refresh`, an access token close to expiry is
   * renewed through the app's single-flight refresh first; the handoff asks for that
   * only after every check and the user's consent have passed, so an outside process
   * can never make the desktop rotate its refresh token.
   */
  getSession: (options?: { refresh?: boolean }) => Promise<DesktopSession | null>;
  isTrusted: (clientId: string, exePath: string) => Promise<boolean>;
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  now?: () => number;
  trust: (clientId: string, exePath: string) => Promise<void>;
  userAgent?: string;
  verifyExecutable: (
    exePath: string | undefined,
    verification: AppHandoffVerification,
  ) => Promise<boolean>;
}

const SERVER_ERROR_MAP: Record<string, AppHandoffErrorCode> = {
  access_denied: 'denied',
  invalid_redirect_uri: 'invalid_request',
  invalid_request: 'invalid_request',
  invalid_scope: 'invalid_request',
  invalid_target: 'invalid_request',
  invalid_token: 'not_signed_in',
  issuer_mismatch: 'issuer_mismatch',
  not_available: 'not_available',
  rate_limited: 'rate_limited',
  unauthorized_client: 'unauthorized_client',
  user_mismatch: 'user_mismatch',
};

export const issuerFor = (serverUrl: string) => `${normalizeIssuer(serverUrl)}/oidc`;

/**
 * Decides whether a local app may sign in with this desktop app's account and,
 * if so, obtains a one-time code for that app's own OIDC client.
 *
 * Never returns, logs or forwards the desktop app's access or refresh token:
 * the access token goes only to its own server, in the request that asks for
 * the code.
 */
export class AppHandoffService {
  private targets?: { promise: Promise<HandoffTargets>; serverUrl: string };
  private recent: number[] = [];

  constructor(private readonly deps: AppHandoffServiceDeps) {}

  /** Forgets the cached target list, e.g. after sign-in, sign-out or a server change. */
  reset() {
    this.targets = undefined;
  }

  /**
   * The targets the server allows for the current session. An empty list (or
   * a server without the endpoint) means the handoff is off.
   */
  async loadTargets(session?: DesktopSession | null): Promise<HandoffTargets | null> {
    const current = session ?? (await this.deps.getSession({ refresh: false }));
    if (!current) return null;

    if (!this.targets || this.targets.serverUrl !== current.serverUrl) {
      const promise = this.fetchTargets(current);
      this.targets = { promise, serverUrl: current.serverUrl };
      promise.catch(() => {
        if (this.targets?.promise === promise) this.targets = undefined;
      });
    }
    return this.targets.promise;
  }

  async handle(request: AppHandoffHttpRequest, serverPort: number) {
    try {
      this.consumeLocalRate();
      if (request.route === 'status') {
        return { body: await this.status(serverPort, request.remotePort) };
      }
      return { body: await this.code(request.body, serverPort, request.remotePort) };
    } catch (error) {
      if (error instanceof AppHandoffError) {
        const body = request.body as Record<string, unknown> | undefined;
        this.deps.log?.warn('[AppHandoff] refused', {
          clientId: typeof body?.client_id === 'string' ? body.client_id : undefined,
          error: error.code,
          reason: error.message,
          route: request.route,
        });
      }
      throw error;
    }
  }

  async status(serverPort: number, remotePort: number): Promise<AppHandoffStatusResponse> {
    const session = await this.deps.getSession({ refresh: false });
    if (!session) return { issuer: '', signedIn: false };

    const issuer = issuerFor(session.serverUrl);
    const peer = await this.deps.findPeer(serverPort, remotePort);
    if (!peer?.sameUser) return { issuer, signedIn: true };

    // The user id is only for a caller recognised without asking: a status poll never opens a dialog.
    const targets = await this.loadTargets(session).catch(() => null);
    let recognised = false;
    for (const target of targets?.targets ?? []) {
      if (
        (await this.deps.verifyExecutable(peer.exePath, target.verification)) ||
        (peer.exePath && (await this.deps.isTrusted(target.client_id, peer.exePath)))
      ) {
        recognised = true;
        break;
      }
    }
    return recognised && targets
      ? { issuer, signedIn: true, sub: targets.sub }
      : { issuer, signedIn: true };
  }

  async code(
    body: unknown,
    serverPort: number,
    remotePort: number,
  ): Promise<AppHandoffCodeResponse> {
    const request = parseCodeRequest(body);

    // Who is calling comes first, before the session is touched: an unidentified
    // caller or another OS user is refused outright, never offered a dialog.
    const peer = await this.deps.findPeer(serverPort, remotePort);
    if (!peer) throw new AppHandoffError('forbidden', 'the caller could not be identified');
    if (!peer.sameUser)
      throw new AppHandoffError('forbidden', 'the caller runs as another OS user');
    await this.assertRedirectOwner(request.redirect_uri, peer.pid);

    const { target } = await this.preflight(request);

    const verified = await this.deps.verifyExecutable(peer.exePath, target.verification);
    if (!verified) {
      const trusted = !!peer.exePath && (await this.deps.isTrusted(target.client_id, peer.exePath));
      if (!trusted) {
        const answer = await this.deps.confirm({
          appName: target.name,
          exePath: peer.exePath,
          rememberable: !!peer.exePath,
        });
        if (!answer.allowed) throw new AppHandoffError('denied', 'the user did not allow this app');
        if (answer.remember && peer.exePath) await this.deps.trust(target.client_id, peer.exePath);
      }
    }

    this.deps.log?.info('[AppHandoff] issuing code', {
      clientId: target.client_id,
      exePath: peer.exePath,
      pid: peer.pid,
      verified,
    });
    return this.requestCode(request);
  }

  /**
   * Handles `<scheme>://app/handoff?...` for an app that found no running
   * desktop app. Anything can open a deep link, so the user always confirms,
   * and the result travels only by a POST to the app's loopback redirect.
   */
  async deepLink(params: Record<string, string>) {
    let request: AppHandoffCodeRequest;
    try {
      request = parseCodeRequest(params);
    } catch (error) {
      this.deps.log?.warn('[AppHandoff] ignoring malformed deep link', error);
      return false;
    }

    // The result goes to whoever listens on the redirect: it must be this OS user,
    // or nothing is sent at all (not even an error).
    try {
      await this.assertRedirectOwner(request.redirect_uri);
    } catch (error) {
      this.deps.log?.warn('[AppHandoff] ignoring deep link', (error as Error).message);
      return false;
    }

    let result: Record<string, string>;
    try {
      const { target } = await this.preflight(request);
      const answer = await this.deps.confirm({ appName: target.name, rememberable: false });
      if (!answer.allowed) throw new AppHandoffError('denied', 'the user did not allow this app');
      const issued = await this.requestCode(request);
      result = { code: issued.code, iss: issued.iss, state: issued.state };
    } catch (error) {
      const code = error instanceof AppHandoffError ? error.code : 'server_error';
      result = { error: code, state: request.state };
    }

    try {
      await this.deps.fetch(request.redirect_uri, {
        body: new URLSearchParams(result),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        redirect: 'manual',
      });
    } catch (error) {
      this.deps.log?.warn('[AppHandoff] could not deliver the deep link result', error);
      return false;
    }
    return !('error' in result);
  }

  /**
   * The code is bound to the redirect URI, so its listener must belong to this
   * OS user and, when the caller's process is known, be that very process.
   */
  private async assertRedirectOwner(redirectUri: string, callerPid?: number) {
    const listener = await this.deps.findListener(Number(new URL(redirectUri).port));
    if (!listener?.sameUser) {
      throw new AppHandoffError('forbidden', 'redirect_uri is not served by this user');
    }
    if (callerPid !== undefined && listener.pid !== undefined && listener.pid !== callerPid) {
      throw new AppHandoffError('forbidden', 'redirect_uri is not served by the caller');
    }
  }

  private async preflight(request: AppHandoffCodeRequest) {
    const session = await this.deps.getSession({ refresh: false });
    if (!session) throw new AppHandoffError('not_signed_in', 'LobeHub Desktop is not signed in');

    const issuer = issuerFor(session.serverUrl);
    if (normalizeIssuer(request.issuer) !== issuer) {
      throw new AppHandoffError(
        'issuer_mismatch',
        'LobeHub Desktop is signed in to another server',
        {
          issuer,
        },
      );
    }

    const targets = await this.loadTargets(session);
    const target = targets?.targets.find((item) => item.client_id === request.client_id);
    if (!targets || !target) {
      throw new AppHandoffError('unauthorized_client', 'this app may not use the desktop sign-in');
    }
    if (request.sub && request.sub !== targets.sub) {
      throw new AppHandoffError('user_mismatch', 'LobeHub Desktop is signed in as another user');
    }

    return { session, target };
  }

  private async requestCode(request: AppHandoffCodeRequest): Promise<AppHandoffCodeResponse> {
    // Every check and the consent have passed: only now may the token be refreshed.
    const session = await this.deps.getSession({ refresh: true });
    if (!session) throw new AppHandoffError('not_signed_in', 'LobeHub Desktop is not signed in');

    const body = {
      client_id: request.client_id,
      code_challenge: request.code_challenge,
      code_challenge_method: 'S256',
      issuer: request.issuer,
      redirect_uri: request.redirect_uri,
      resource: request.resource,
      scope: request.scope,
      sub: request.sub,
    };
    const data = await this.call(session, 'POST', body);
    if (
      typeof data.code !== 'string' ||
      normalizeIssuer(String(data.iss)) !== issuerFor(session.serverUrl)
    ) {
      throw new AppHandoffError('server_error', 'unexpected handoff response');
    }
    return {
      code: data.code,
      expires_in: Number(data.expires_in),
      iss: String(data.iss),
      state: request.state,
    };
  }

  private async fetchTargets(session: DesktopSession): Promise<HandoffTargets> {
    const data = await this.call(session, 'GET');
    return {
      issuer: String(data.issuer),
      sub: String(data.sub),
      targets: Array.isArray(data.targets) ? (data.targets as HandoffTarget[]) : [],
    };
  }

  private async call(session: DesktopSession, method: 'GET' | 'POST', body?: unknown) {
    const headers: Record<string, string> = { 'Oidc-Auth': session.accessToken };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.deps.userAgent) headers['User-Agent'] = this.deps.userAgent;

    let response: Response;
    try {
      response = await this.deps.fetch(
        `${normalizeIssuer(session.serverUrl)}${NATIVE_HANDOFF_SERVER_PATH}`,
        {
          body: body ? JSON.stringify(body) : undefined,
          headers,
          method,
        },
      );
    } catch {
      throw new AppHandoffError('server_error', 'could not reach the server');
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return data;

    const mapped =
      SERVER_ERROR_MAP[String(data.error)] ??
      (response.status === 404 ? 'not_available' : 'server_error');
    throw new AppHandoffError(
      mapped,
      String(data.error_description ?? data.error ?? response.status),
    );
  }

  private consumeLocalRate() {
    const now = (this.deps.now ?? Date.now)();
    this.recent = this.recent.filter((at) => now - at < 60_000);
    if (this.recent.length >= APP_HANDOFF_LOCAL_RATE_LIMIT) {
      throw new AppHandoffError('rate_limited', 'too many handoff requests');
    }
    this.recent.push(now);
  }
}
