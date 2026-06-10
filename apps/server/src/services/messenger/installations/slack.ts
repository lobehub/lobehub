import debug from 'debug';

import { getMessengerSlackConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  type DecryptedMessengerInstallation,
  MessengerInstallationModel,
} from '@/database/models/messengerInstallation';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { refreshToken as refreshSlackToken } from '@/server/services/messenger/oauth/slackOAuth';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:slack');

/** Refresh proactively when within this many ms of `tokenExpiresAt`. */
const REFRESH_BUFFER_MS = 120_000;

const installationKey = (tenantId: string): string => `slack:${tenantId}`;

const parseInstallationKey = (key: string): string | null => {
  if (!key.startsWith('slack:')) return null;
  return key.slice('slack:'.length);
};

interface SlackCredentialsBlob {
  botToken?: string;
  refreshToken?: string;
}

const toCredentials = (
  row: DecryptedMessengerInstallation,
  signingSecret: string,
): InstallationCredentials | null => {
  const blob = row.credentials as SlackCredentialsBlob;
  if (!blob.botToken) {
    log('toCredentials: install row %s has no botToken', row.id);
    return null;
  }
  return {
    accountId: row.accountId ?? undefined,
    applicationId: row.applicationId,
    botToken: blob.botToken,
    installationKey: installationKey(row.tenantId),
    metadata: row.metadata ?? {},
    platform: 'slack',
    signingSecret,
    tenantId: row.tenantId,
  };
};

const isExpiringSoon = (row: DecryptedMessengerInstallation): boolean => {
  if (!row.tokenExpiresAt) return false;
  return row.tokenExpiresAt.getTime() - Date.now() <= REFRESH_BUFFER_MS;
};

/**
 * Resolve a Slack tenant id out of an inbound webhook payload.
 *
 * Slack delivers events in three shapes; each carries the tenant id in a
 * different place:
 *
 * - **Events API** (`application/json`): top-level `team_id`, plus
 *   `authorizations[0].{team_id, enterprise_id, is_enterprise_install}`.
 *   We prefer `authorizations[0]` because Slack Connect / shared channels
 *   have an event team that differs from the install team.
 * - **Interactivity** (form-encoded `payload=<json>`): `team.id`,
 *   `enterprise.id`, `is_enterprise_install` at the JSON top level.
 * - **Slash commands** (form-encoded fields): `team_id`, `enterprise_id`,
 *   `is_enterprise_install`.
 *
 * Returns null when the payload doesn't look like Slack or doesn't carry an
 * identifiable tenant.
 */
const extractSlackTenant = (
  contentType: string,
  rawBody: string,
): { applicationId?: string; tenantId: string } | null => {
  // Events API → JSON
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(rawBody);
      // url_verification challenge — Slack pings the endpoint at setup time
      // with no install yet; nothing to resolve.
      if (parsed?.type === 'url_verification') return null;

      const auth = Array.isArray(parsed.authorizations) ? parsed.authorizations[0] : null;
      const isEnterprise =
        auth?.is_enterprise_install === true || parsed.is_enterprise_install === true;
      const tenantId = isEnterprise
        ? (auth?.enterprise_id ?? parsed.enterprise_id)
        : (auth?.team_id ?? parsed.team_id);
      if (!tenantId) return null;
      return { applicationId: parsed.api_app_id ?? undefined, tenantId: String(tenantId) };
    } catch {
      return null;
    }
  }

  // Interactivity (block_actions / view_submission / shortcut) AND
  // slash_commands both arrive form-encoded.
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');
    if (payloadStr) {
      // Interactivity payload
      try {
        const payload = JSON.parse(payloadStr);
        const isEnterprise = payload?.is_enterprise_install === true;
        const tenantId = isEnterprise ? payload?.enterprise?.id : payload?.team?.id;
        if (!tenantId) return null;
        return { applicationId: payload?.api_app_id ?? undefined, tenantId: String(tenantId) };
      } catch {
        return null;
      }
    }
    // Slash command — top-level form fields
    const isEnterprise = params.get('is_enterprise_install') === 'true';
    const tenantId = isEnterprise ? params.get('enterprise_id') : params.get('team_id');
    if (!tenantId) return null;
    return { applicationId: params.get('api_app_id') ?? undefined, tenantId };
  }

  return null;
};

/**
 * Slack-specific resolver. Reads from `messenger_installations`, decrypts
 * credentials lazily, and proactively refreshes rotating tokens before they
 * expire — single-flight per tenant so concurrent inbound webhooks for the
 * same workspace don't stampede `oauth.v2.access`.
 */
export class SlackInstallationStore implements MessengerInstallationStore {
  /**
   * In-process single-flight lock. Each refresh creates a Promise here keyed
   * by `tenantId`; concurrent callers await the same Promise instead of all
   * triggering their own refresh. Cleared in the `finally` so a failed
   * refresh doesn't poison the slot.
   *
   * This is per-process — for multi-replica deployments two replicas could
   * still both refresh concurrently. Slack handles that gracefully (each
   * refresh succeeds independently, the latest write wins) but burns an
   * extra `oauth.v2.access` request. A Redis lock would harden this; deferred
   * until we see the load.
   */
  private inflightRefresh = new Map<string, Promise<DecryptedMessengerInstallation | null>>();

  async resolveByPayload(req: Request, rawBody: string): Promise<InstallationCredentials | null> {
    const contentType = req.headers.get('content-type') ?? '';
    const tenant = extractSlackTenant(contentType, rawBody);
    if (!tenant) return null;
    return this.lookup(tenant.tenantId, tenant.applicationId);
  }

  async resolveByKey(key: string): Promise<InstallationCredentials | null> {
    const tenantId = parseInstallationKey(key);
    if (!tenantId) return null;
    return this.lookup(tenantId);
  }

  async markRevoked(key: string): Promise<void> {
    const tenantId = parseInstallationKey(key);
    if (!tenantId) return;

    const config = await getMessengerSlackConfig();
    const serverDB = await getServerDB();
    const gateKeeper = await this.getGateKeeper();
    const row = await MessengerInstallationModel.findByTenant(
      serverDB,
      'slack',
      tenantId,
      config?.appId,
      gateKeeper,
    );
    if (!row) {
      log('markRevoked: no install for tenant=%s', tenantId);
      return;
    }
    await MessengerInstallationModel.markRevoked(serverDB, row.id);
    log('markRevoked: marked install id=%s tenant=%s', row.id, tenantId);
  }

  // ----------------------------------------------------------------------

  private async lookup(
    tenantId: string,
    applicationId?: string,
  ): Promise<InstallationCredentials | null> {
    const config = await getMessengerSlackConfig();
    if (!config) {
      log('lookup: Slack OAuth env not configured');
      return null;
    }

    const serverDB = await getServerDB();
    const gateKeeper = await this.getGateKeeper();
    const appId = applicationId ?? config.appId;

    let row = await MessengerInstallationModel.findByTenant(
      serverDB,
      'slack',
      tenantId,
      appId,
      gateKeeper,
    );
    if (!row) {
      log('lookup: no install for (slack, %s, %s)', tenantId, appId);
      return null;
    }

    if (isExpiringSoon(row)) {
      log('lookup: token for tenant=%s expires soon, refreshing', tenantId);
      const refreshed = await this.refreshSingleFlight(tenantId, row);
      if (refreshed) row = refreshed;
    }

    return toCredentials(row, config.signingSecret);
  }

  private async refreshSingleFlight(
    tenantId: string,
    row: DecryptedMessengerInstallation,
  ): Promise<DecryptedMessengerInstallation | null> {
    const existing = this.inflightRefresh.get(tenantId);
    if (existing) return existing;

    const promise = this.runRefresh(row).finally(() => {
      this.inflightRefresh.delete(tenantId);
    });
    this.inflightRefresh.set(tenantId, promise);
    return promise;
  }

  private async runRefresh(
    row: DecryptedMessengerInstallation,
  ): Promise<DecryptedMessengerInstallation | null> {
    const config = await getMessengerSlackConfig();
    if (!config) return null;

    const blob = row.credentials as SlackCredentialsBlob;
    if (!blob.refreshToken) {
      log('runRefresh: install id=%s has no refresh_token (rotation off)', row.id);
      return null;
    }

    let response;
    try {
      response = await refreshSlackToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: blob.refreshToken,
      });
    } catch (error) {
      log('runRefresh: oauth.v2.access (refresh) failed for id=%s: %O', row.id, error);
      return null;
    }

    if (!response.access_token) {
      log('runRefresh: refresh response missing access_token for id=%s', row.id);
      return null;
    }

    const newCredentials: Record<string, unknown> = {
      botToken: response.access_token,
      refreshToken: response.refresh_token ?? blob.refreshToken,
    };
    const newExpiresAt =
      typeof response.expires_in === 'number'
        ? new Date(Date.now() + response.expires_in * 1000)
        : null;

    const serverDB = await getServerDB();
    const gateKeeper = await this.getGateKeeper();
    await MessengerInstallationModel.updateRotatedToken(
      serverDB,
      row.id,
      { credentials: newCredentials, tokenExpiresAt: newExpiresAt },
      gateKeeper,
    );

    return {
      ...row,
      credentials: newCredentials as Record<string, unknown>,
      tokenExpiresAt: newExpiresAt,
    };
  }

  private gateKeeperPromise?: Promise<KeyVaultsGateKeeper>;

  /** Lazily init the encryptor — `KEY_VAULTS_SECRET` is constant per process. */
  private getGateKeeper(): Promise<KeyVaultsGateKeeper> {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }
    return this.gateKeeperPromise;
  }
}
