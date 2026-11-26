import { randomUUID } from 'node:crypto';

import { OAuthError, OAuthErrorCode, type OAuthTokens } from '@modelcontextprotocol/client';
import debug from 'debug';
import pMap from 'p-map';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import {
  type DecryptedConnectorLink,
  LEGACY_LINK_ID,
  type OAuthCredentials,
} from '@/database/models/connectorLink';

import {
  discoverConnectorAuthorizationServerMetadata,
  refreshConnectorToken,
  toClientInformation,
} from './oauth';

const log = debug('lobe-server:connector:tokens');

/** Refresh slightly before actual expiry to avoid races on the boundary. */
const EXPIRY_SKEW_MS = 60_000;

/** Map an OAuth token response into the persisted credential + expiry shape. */
export const tokensToCredentials = (
  tokens: OAuthTokens,
  opts: { clientSecret?: string; fallbackRefreshToken?: string } = {},
): { credentials: OAuthCredentials; tokenExpiresAt: Date | null } => {
  const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  return {
    credentials: {
      accessToken: tokens.access_token,
      clientSecret: opts.clientSecret,
      expiresAt,
      // Refresh tokens may rotate; keep the previous one when the AS omits it.
      refreshToken: tokens.refresh_token ?? opts.fallbackRefreshToken,
      scope: tokens.scope,
      type: 'oauth2',
    },
    tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
  };
};

const RUN_TOKEN_REFRESH_TIMEOUT_MS = 5000;
const RUN_TOKEN_REFRESH_CONCURRENCY = 5;
const REFRESH_REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_ATTEMPT_TTL_MS = 30_000;
const REFRESH_POLL_INTERVAL_MS = 500;

const isRefreshDue = (
  credentials: DecryptedConnector['credentials'],
): credentials is OAuthCredentials & { refreshToken: string } =>
  credentials?.type === 'oauth2' &&
  !!credentials.refreshToken &&
  (!credentials.expiresAt || credentials.expiresAt - EXPIRY_SKEW_MS <= Date.now());

interface RefreshSlot {
  connector: DecryptedConnector;
  credentials: OAuthCredentials;
  link?: DecryptedConnectorLink;
  linkCount: number;
}

const readSlot = async (
  connector: DecryptedConnector,
  model: ConnectorModel,
  linkId?: string,
): Promise<RefreshSlot | undefined> => {
  if (!linkId && connector.credentials?.type === 'oauth2') {
    return { connector, credentials: connector.credentials, linkCount: 0 };
  }
  // An older single-token row can be migrated to an account while a run
  // still holds the old snapshot. Both entry points target that same slot.
  const links = await model.getLinkModel().listByConnectorIds([connector.id]);
  const link = links.find((item) => item.id === (linkId ?? LEGACY_LINK_ID));
  if (link) return { connector, credentials: link.credentials, link, linkCount: links.length };
};

const writeSlot = async (
  model: ConnectorModel,
  slot: RefreshSlot,
  credentials: OAuthCredentials,
  update?: {
    authMethod?: NonNullable<DecryptedConnector['oidcConfig']>['tokenEndpointAuthMethod'];
    status: 'connected' | 'error';
  },
): Promise<RefreshSlot> => {
  const { connector, link, linkCount } = slot;
  const tokenExpiresAt = credentials.expiresAt ? new Date(credentials.expiresAt) : null;
  const oidcConfig =
    update?.authMethod && connector.oidcConfig
      ? { ...connector.oidcConfig, tokenEndpointAuthMethod: update.authMethod }
      : undefined;
  const status = linkCount <= 1 && update?.status === 'error' ? update.status : undefined;

  if (link && connector.credentials?.type !== 'oauth2') {
    await model
      .getLinkModel()
      .updateCredentials(connector.id, link.id, credentials, update?.status ?? link.status);
    if (status || oidcConfig) {
      await model.update(connector.id, {
        ...(status && { status }),
        ...(oidcConfig && { oidcConfig }),
      });
    }
  } else {
    await model.update(connector.id, {
      credentials: JSON.stringify(credentials),
      tokenExpiresAt,
      ...(status && { status }),
      ...(oidcConfig && { oidcConfig }),
    });
  }

  return {
    ...slot,
    connector: { ...connector, ...(status && { status }), ...(oidcConfig && { oidcConfig }) },
    credentials,
    link: link && { ...link, credentials, status: update?.status ?? link.status, tokenExpiresAt },
  };
};

const reconnectCredentials = (credentials: OAuthCredentials): OAuthCredentials => ({
  ...credentials,
  refreshState: { status: 'reconnect_required' },
  refreshToken: undefined,
});

const isSameCredential = (current: OAuthCredentials, original: OAuthCredentials) =>
  current.refreshToken === original.refreshToken &&
  current.accessToken === original.accessToken &&
  current.expiresAt === original.expiresAt &&
  current.refreshState?.status === original.refreshState?.status &&
  (current.refreshState?.status !== 'complete' ||
    (original.refreshState?.status === 'complete' &&
      current.refreshState.id === original.refreshState.id));

type RefreshDecision =
  | { kind: 'done'; slot?: RefreshSlot }
  | { kind: 'send'; attemptId: string; deadline: number; slot: RefreshSlot }
  | { kind: 'wait'; deadline: number; slot: RefreshSlot };

const claimRefresh = (
  connector: DecryptedConnector,
  original: OAuthCredentials,
  model: ConnectorModel,
  linkId?: string,
) =>
  model.withOAuthRefreshLock<RefreshDecision>(connector, async (row, lockedModel) => {
    const slot = await readSlot(row, lockedModel, linkId);
    if (!slot) return { kind: 'done' };
    const { credentials } = slot;
    const state = credentials.refreshState;
    if (state?.status === 'pending') {
      if (state.deadline > Date.now()) return { deadline: state.deadline, kind: 'wait', slot };
      // The owner may have submitted the token before exiting. Its outcome
      // is unknown, so allowing a new owner to send the same token is unsafe.
      const failed = await writeSlot(lockedModel, slot, reconnectCredentials(credentials), {
        status: 'error',
      });
      return { kind: 'done', slot: failed };
    }

    if (
      !row.isEnabled ||
      !row.oidcConfig?.issuer ||
      !row.oidcConfig.clientId ||
      !isSameCredential(credentials, original) ||
      !isRefreshDue(credentials)
    ) {
      return { kind: 'done', slot };
    }

    const attemptId = randomUUID();
    const deadline = Date.now() + REFRESH_ATTEMPT_TTL_MS;
    await writeSlot(lockedModel, slot, {
      ...credentials,
      refreshState: { deadline, id: attemptId, status: 'pending' },
    });
    // The claim commits before the OAuth request starts. No database lock or
    // transaction needs to stay open while waiting on the provider.
    return { attemptId, deadline, kind: 'send', slot };
  });

const fetchRefresh = async (slot: RefreshSlot, attemptId: string, signal: AbortSignal) => {
  const { connector, credentials } = slot;
  const oidc = connector.oidcConfig;
  if (!oidc?.issuer || !credentials.refreshToken) return;
  const metadata = await discoverConnectorAuthorizationServerMetadata(oidc.issuer, signal);
  if (!metadata) return;
  signal.throwIfAborted();

  try {
    const { authMethod, tokens } = await refreshConnectorToken({
      authorizationServerUrl: oidc.issuer,
      clientInformation: toClientInformation(oidc),
      metadata,
      refreshToken: credentials.refreshToken,
      resource: connector.mcpServerUrl ?? undefined,
      signal,
    });
    return {
      authMethod,
      credentials: {
        ...tokensToCredentials(tokens, {
          clientSecret: oidc.clientSecret,
          fallbackRefreshToken: credentials.refreshToken,
        }).credentials,
        refreshState: { id: attemptId, status: 'complete' as const },
      },
      status: 'connected' as const,
    };
  } catch (error) {
    if (
      !signal.aborted &&
      OAuthError.isInstance(error) &&
      error.code !== OAuthErrorCode.InvalidGrant &&
      error.code !== OAuthErrorCode.ServerError
    ) {
      // The provider explicitly rejected the request without issuing tokens.
      return;
    }
    // A rejected grant or an uncertain transport/server failure must not
    // cause another submission. The provider may already have rotated it.
    return { credentials: reconnectCredentials(credentials), status: 'error' as const };
  }
};

const runClaimedRefresh = async (
  decision: Extract<RefreshDecision, { kind: 'send' }>,
  model: ConnectorModel,
  linkId?: string,
) => {
  const { attemptId, deadline, slot } = decision;
  let result: Awaited<ReturnType<typeof fetchRefresh>>;
  try {
    const remaining = Math.min(REFRESH_REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (remaining > 0) result = await fetchRefresh(slot, attemptId, AbortSignal.timeout(remaining));
  } catch (error) {
    // Discovery failed before the token request was sent.
    log(
      'OAuth discovery failed for connector=%s errorType=%s',
      slot.connector.id,
      error instanceof Error ? error.name : typeof error,
    );
  }

  return model.withOAuthRefreshLock(slot.connector, async (row, lockedModel) => {
    const current = await readSlot(row, lockedModel, linkId);
    if (!current) return;
    const state = current.credentials.refreshState;
    // Reauthorization, account removal or a newer outcome won while the
    // OAuth request was in flight. Leave that state alone.
    if (state?.status !== 'pending' || state.id !== attemptId) return current;
    return writeSlot(lockedModel, current, result?.credentials ?? slot.credentials, result);
  });
};

/**
 * Every refresh reads and writes the row through its own scope
 * (`ConnectorModel.forRow`): a private agent's workspace run can resolve its
 * owner's personal connector, whose token the run's workspace-scoped model can
 * neither find nor update — a rotated refresh token would be dropped.
 */
const refreshSlot = async (
  connector: DecryptedConnector,
  credentials: DecryptedConnector['credentials'],
  runModel: ConnectorModel,
  linkId?: string,
  waitUntil = Date.now() + REFRESH_ATTEMPT_TTL_MS,
): Promise<RefreshSlot | undefined> => {
  if (!isRefreshDue(credentials)) return;
  const model = runModel.forRow(connector);
  try {
    while (true) {
      const decision = await claimRefresh(connector, credentials, model, linkId);
      if (!decision || decision.kind === 'done') return decision?.slot;
      if (decision.kind === 'send') return await runClaimedRefresh(decision, model, linkId);
      if (Date.now() >= waitUntil) return decision.slot;
      const now = Date.now();
      const delay = Math.min(REFRESH_POLL_INTERVAL_MS, decision.deadline - now, waitUntil - now);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } catch (error) {
    log(
      'OAuth refresh state failed for connector=%s errorType=%s',
      connector.id,
      error instanceof Error ? error.name : typeof error,
    );
  }
};

export const ensureFreshConnectorToken = async (
  connector: DecryptedConnector,
  model: ConnectorModel,
  waitUntil?: number,
): Promise<DecryptedConnector> => {
  const slot = await refreshSlot(connector, connector.credentials, model, undefined, waitUntil);
  if (!slot) return connector;
  const { credentials } = slot;
  return {
    ...slot.connector,
    credentials,
    tokenExpiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : null,
  };
};

export const ensureFreshLinkToken = async (
  connector: DecryptedConnector,
  link: DecryptedConnectorLink,
  model: ConnectorModel,
  waitUntil?: number,
): Promise<DecryptedConnectorLink> =>
  (await refreshSlot(connector, link.credentials, model, link.id, waitUntil))?.link ?? link;

/** Bound the caller's wait while a claimed refresh continues to persist its outcome. */
const waitForRunRefresh = async <T>(
  original: T,
  refresh: (waitUntil: number) => Promise<T>,
  onTimeout?: () => void,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitUntil = Date.now() + RUN_TOKEN_REFRESH_TIMEOUT_MS;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve(original);
    }, RUN_TOKEN_REFRESH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, refresh(waitUntil)]);
  } finally {
    clearTimeout(timer);
  }
};

export const refreshExpiredConnectorTokens = (
  connectors: DecryptedConnector[],
  model: ConnectorModel,
  options: { onTimeout?: () => void } = {},
): Promise<DecryptedConnector[]> =>
  pMap(
    connectors,
    // When a provider omitted expires_in, the agent run has no expiry to act on.
    (connector) =>
      connector.isEnabled &&
      connector.credentials?.type === 'oauth2' &&
      connector.credentials.expiresAt
        ? waitForRunRefresh(
            connector,
            (waitUntil) => ensureFreshConnectorToken(connector, model, waitUntil),
            options.onTimeout,
          )
        : connector,
    { concurrency: RUN_TOKEN_REFRESH_CONCURRENCY },
  );

export const refreshExpiredLinkTokens = (
  connector: DecryptedConnector,
  links: DecryptedConnectorLink[],
  model: ConnectorModel,
  options: { onTimeout?: () => void } = {},
): Promise<DecryptedConnectorLink[]> =>
  pMap(
    links,
    (link) =>
      connector.isEnabled && link.credentials.expiresAt
        ? waitForRunRefresh(
            link,
            (waitUntil) => ensureFreshLinkToken(connector, link, model, waitUntil),
            options.onTimeout,
          )
        : link,
    { concurrency: RUN_TOKEN_REFRESH_CONCURRENCY },
  );
