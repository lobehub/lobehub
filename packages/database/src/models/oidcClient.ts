import { type OAuthAppType } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  oidcAccessTokens,
  oidcClients,
  oidcConsents,
  oidcDeviceCodes,
  oidcGrants,
  oidcRefreshTokens,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

interface CreateOidcClientParams {
  description?: string | null;
  /** Issue a `web` app's client secret at creation. Ignored for `device` apps. */
  issueSecret?: boolean;
  logoUri?: string | null;
  name: string;
  /** Required for `web` apps, ignored for `device` apps. */
  redirectUris?: string[];
  type?: OAuthAppType;
}

interface UpdateOidcClientParams {
  description?: string | null;
  logoUri?: string | null;
  name?: string;
  /** Only meaningful for `web` apps; ignored when the app has no redirect flow. */
  redirectUris?: string[];
}

const DEVICE_FLOW_GRANTS = ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'];
const WEB_FLOW_GRANTS = ['authorization_code', 'refresh_token'];
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

const generateClientId = () => `lca_${createNanoId(24)()}`;

/**
 * Client secrets are issued once and never shown again, so they carry real
 * entropy from the platform CSPRNG rather than the non-secure nanoid used for
 * public identifiers.
 */
const generateClientSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `lcs_${Buffer.from(bytes).toString('base64url')}`;
};

export class OidcClientModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, oidcClients);

  private async getGateKeeper() {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }

    return this.gateKeeperPromise;
  }

  /**
   * Issues a secret and returns both halves: the plaintext to hand back to the
   * creator exactly once, and the encrypted form to store. The OIDC token
   * endpoint needs the plaintext to authenticate the client, so this is
   * encrypted at rest rather than hashed (see the adapter's `find`).
   */
  private issueClientSecret = async () => {
    const secret = generateClientSecret();
    const gateKeeper = await this.getGateKeeper();

    return { encrypted: await gateKeeper.encrypt(secret), secret };
  };

  /**
   * Creates an app and, for a `web` app when `issueSecret` is set, issues its
   * client secret, returned once as `secret`.
   *
   * `device` apps stay public clients with no secret: the device flow has no
   * confidential channel to keep one in. `web` apps are confidential clients
   * (the only consumer that can use a redirect flow here is a server that can
   * hold a secret). Without `issueSecret` their secret is minted later through
   * `rotateSecret`, when the owner is ready to store it; until then the
   * provider treats the client as unusable (see the adapter).
   */
  create = async (params: CreateOidcClientParams) => {
    const isWeb = params.type === 'web';
    const { encrypted, secret } =
      isWeb && params.issueSecret
        ? await this.issueClientSecret()
        : { encrypted: null, secret: undefined };

    const [result] = await this.db
      .insert(oidcClients)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            applicationType: isWeb ? 'web' : 'native',
            clientSecret: encrypted,
            description: params.description,
            grants: isWeb ? WEB_FLOW_GRANTS : DEVICE_FLOW_GRANTS,
            id: generateClientId(),
            isFirstParty: false,
            logoUri: params.logoUri,
            name: params.name,
            redirectUris: isWeb ? (params.redirectUris ?? []) : [],
            responseTypes: isWeb ? ['code'] : [],
            scopes: DEFAULT_SCOPES,
            tokenEndpointAuthMethod: isWeb ? 'client_secret_post' : 'none',
          },
        ),
      )
      .returning();

    return { client: result, secret };
  };

  /**
   * Issues the client secret of a web app — the first one, or a replacement —
   * and returns the new plaintext once.
   *
   * Returns `undefined` when the app is not the caller's or is not a
   * confidential client, so a device-flow app can never be turned into a
   * confidential one through this path.
   */
  rotateSecret = async (id: string) => {
    const existing = await this.findById(id);
    if (!existing || !existing.tokenEndpointAuthMethod?.startsWith('client_secret')) {
      return undefined;
    }

    const { encrypted, secret } = await this.issueClientSecret();

    await this.db
      .update(oidcClients)
      .set({ clientSecret: encrypted, updatedAt: new Date() })
      .where(and(eq(oidcClients.id, id), this.ownership()));

    return secret;
  };

  list = async () => {
    return this.db
      .select()
      .from(oidcClients)
      .where(this.ownership())
      .orderBy(desc(oidcClients.createdAt));
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(oidcClients)
      .where(and(eq(oidcClients.id, id), this.ownership()))
      .limit(1);

    return result;
  };

  update = async (id: string, value: UpdateOidcClientParams) => {
    const { redirectUris, ...rest } = value;

    // A device-flow app has no redirect leg, so ignoring the field for anything
    // but a web app keeps a stray payload from granting it one.
    const isWeb = redirectUris ? (await this.findById(id))?.applicationType === 'web' : false;

    return this.db
      .update(oidcClients)
      .set({
        ...rest,
        ...(redirectUris && isWeb ? { redirectUris } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(oidcClients.id, id), this.ownership()));
  };

  setEnabled = async (id: string, enabled: boolean) => {
    return this.db
      .update(oidcClients)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(oidcClients.id, id), this.ownership()));
  };

  delete = async (id: string) => {
    return this.db.transaction(async (trx) => {
      const [client] = await trx
        .select({ id: oidcClients.id })
        .from(oidcClients)
        .where(and(eq(oidcClients.id, id), this.ownership()))
        .limit(1);

      if (!client) return;

      await Promise.all([
        trx.delete(oidcGrants).where(eq(oidcGrants.clientId, id)),
        trx.delete(oidcRefreshTokens).where(eq(oidcRefreshTokens.clientId, id)),
        trx.delete(oidcAccessTokens).where(eq(oidcAccessTokens.clientId, id)),
        trx.delete(oidcDeviceCodes).where(eq(oidcDeviceCodes.clientId, id)),
        trx.delete(oidcConsents).where(eq(oidcConsents.clientId, id)),
      ]);

      await trx.delete(oidcClients).where(and(eq(oidcClients.id, id), this.ownership()));
    });
  };
}
