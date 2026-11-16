import { createHash } from 'node:crypto';

import type { TfsCredentials } from '@lobechat/types';
import { normalizeTfsCollection } from '@lobechat/utils/tfs';
import { TRPCError } from '@trpc/server';

import { ScmIdentityModel } from '@/database/models/scm';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { TfsClient } from './client';

export const tfsCollection = () =>
  process.env.TFS_COLLECTION_URL ? normalizeTfsCollection(process.env.TFS_COLLECTION_URL) : null;

/** Personal identity only: workspace membership never grants another person's TFS credential. */
export class TfsConnectionService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  async status() {
    const collectionUrl = tfsCollection();
    const identity = await ScmIdentityModel.findByUser(this.db, 'tfs', this.userId);
    return {
      collectionUrl,
      configured: Boolean(collectionUrl),
      hasBinding: Boolean(identity),
      identity:
        identity && identity.metadata.collectionUrl === collectionUrl
          ? { login: identity.externalLogin, updatedAt: identity.updatedAt.toISOString() }
          : null,
    };
  }

  async connect(credentials: TfsCredentials) {
    const collection = this.requireCollection();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const client = new TfsClient(collection, credentials);
    const identity = await client.identity();
    const externalUserId = `${createHash('sha256').update(collection).digest('hex').slice(0, 32)}:${identity.id}`;
    const existing = await ScmIdentityModel.findByUser(this.db, 'tfs', this.userId);
    if (existing && existing.externalUserId !== externalUserId)
      throw new TRPCError({ code: 'CONFLICT', message: 'TFS_DISCONNECT_FIRST' });
    try {
      await ScmIdentityModel.upsert(
        this.db,
        {
          provider: 'tfs',
          userId: this.userId,
          externalUserId,
          externalLogin: identity.login,
          credentials: { accessToken: '', tfs: credentials },
          metadata: { collectionUrl: collection },
        },
        gateKeeper,
      );
    } catch (error) {
      const owner = await ScmIdentityModel.findByExternalUser(this.db, 'tfs', externalUserId);
      if (owner && owner.userId !== this.userId)
        throw new TRPCError({ code: 'CONFLICT', message: 'TFS_IDENTITY_TAKEN' });
      throw error;
    }
    return this.status();
  }

  async disconnect() {
    await ScmIdentityModel.disconnect(this.db, 'tfs', this.userId);
  }

  async credentials() {
    const collection = this.requireCollection();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const identity = await ScmIdentityModel.findByUser(this.db, 'tfs', this.userId, gateKeeper);
    if (!identity?.credentials?.tfs || identity.metadata.collectionUrl !== collection)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TFS_NOT_CONNECTED' });
    return identity.credentials.tfs;
  }

  async client() {
    const collection = this.requireCollection();
    return new TfsClient(collection, await this.credentials());
  }

  private requireCollection() {
    const collection = tfsCollection();
    if (!collection)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TFS_NOT_CONFIGURED' });
    return collection;
  }
}
