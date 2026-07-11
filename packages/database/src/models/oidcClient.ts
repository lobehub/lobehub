import { and, desc, eq } from 'drizzle-orm';

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

interface CreateOidcClientParams {
  description?: string | null;
  logoUri?: string | null;
  name: string;
}

interface UpdateOidcClientParams {
  description?: string | null;
  logoUri?: string | null;
  name?: string;
}

const DEVICE_FLOW_GRANTS = ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'];
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

const generateClientId = () => `lca_${createNanoId(24)()}`;

export class OidcClientModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private ownership = () => eq(oidcClients.ownerId, this.userId);

  create = async (params: CreateOidcClientParams) => {
    const [result] = await this.db
      .insert(oidcClients)
      .values({
        applicationType: 'native',
        clientSecret: null,
        description: params.description,
        grants: DEVICE_FLOW_GRANTS,
        id: generateClientId(),
        isFirstParty: false,
        logoUri: params.logoUri,
        name: params.name,
        ownerId: this.userId,
        redirectUris: [],
        responseTypes: [],
        scopes: DEFAULT_SCOPES,
        tokenEndpointAuthMethod: 'none',
      })
      .returning();

    return result;
  };

  list = async () => {
    return this.db.query.oidcClients.findMany({
      orderBy: [desc(oidcClients.createdAt)],
      where: this.ownership(),
    });
  };

  findById = async (id: string) => {
    return this.db.query.oidcClients.findFirst({
      where: and(eq(oidcClients.id, id), this.ownership()),
    });
  };

  update = async (id: string, value: UpdateOidcClientParams) => {
    return this.db
      .update(oidcClients)
      .set({ ...value, updatedAt: new Date() })
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
      const client = await trx.query.oidcClients.findFirst({
        where: and(eq(oidcClients.id, id), this.ownership()),
      });

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
