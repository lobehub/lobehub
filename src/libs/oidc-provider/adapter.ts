import { type LobeChatDatabase } from '@lobechat/database';
import {
  oidcAccessTokens,
  oidcAuthorizationCodes,
  oidcClients,
  oidcDeviceCodes,
  oidcGrants,
  oidcInteractions,
  oidcRefreshTokens,
  oidcSessions,
} from '@lobechat/database/schemas';
import debug from 'debug';
import { eq, sql } from 'drizzle-orm';

// 创建 adapter 日志命名空间
const log = debug('lobe-oidc:adapter');

/**
 * Grace period for consumed RefreshToken (in seconds)
 *
 * When rotateRefreshToken is enabled, the old refresh token is consumed
 * when a new one is issued. However, if the client fails to receive/save
 * the new token (network issues, crashes), the old token becomes unusable.
 *
 * This grace period allows the consumed refresh token to be reused within
 * a short window, giving clients a chance to retry the refresh operation.
 *
 * Default: 180 seconds (3 minutes)
 */
const REFRESH_TOKEN_GRACE_PERIOD_SECONDS = 180;

class OIDCAdapter {
  private db: LobeChatDatabase;
  private name: string;

  constructor(name: string, db: LobeChatDatabase) {
    log('[%s] Constructor called with name: %s', name, name);

    this.name = name;
    this.db = db;
  }

  /**
   * 根据模型名称获取对应的数据库表
   */
  private getTable() {
    log('Getting table for model: %s', this.name);
    switch (this.name) {
      case 'AccessToken': {
        return oidcAccessTokens;
      }
      case 'AuthorizationCode': {
        return oidcAuthorizationCodes;
      }
      case 'RefreshToken': {
        return oidcRefreshTokens;
      }
      case 'DeviceCode': {
        return oidcDeviceCodes;
      }
      case 'ClientCredentials': {
        return oidcAccessTokens;
      } // 使用相同的表
      case 'Client': {
        return oidcClients;
      }
      case 'InitialAccessToken': {
        return oidcAccessTokens;
      } // 使用相同的表
      case 'RegistrationAccessToken': {
        return oidcAccessTokens;
      } // 使用相同的表
      case 'Interaction': {
        return oidcInteractions;
      }
      case 'ReplayDetection': {
        log('ReplayDetection - no persistent storage needed');
        return null;
      } // 不需要持久化
      case 'PushedAuthorizationRequest': {
        return oidcAuthorizationCodes;
      } // 使用相同的表
      case 'Grant': {
        return oidcGrants;
      }
      case 'Session': {
        return oidcSessions;
      }
      default: {
        const error = `不支持的模型: ${this.name}`;
        log('ERROR: %s', error);
        throw new Error(error);
      }
    }
  }

  /**
   * 创建模型实例
   */
  async upsert(id: string, payload: any, expiresIn: number): Promise<void> {
    log('[%s] upsert called - id: %s, expiresIn: %d', this.name, id, `${expiresIn}s`);
    log('[%s] payload: %O', this.name, payload);

    const table = this.getTable();
    if (!table) {
      log('[%s] upsert - No table for model, returning early', this.name);
      return;
    }

    if (this.name === 'Client') {
      // 客户端模型特殊处理，直接使用传入的数据
      log('[Client] Upserting client record');
      try {
        await this.db
          .insert(table)
          .values({
            applicationType: payload.application_type,
            clientSecret: payload.client_secret,
            clientUri: payload.client_uri,
            description: payload.description,
            grants: payload.grant_types || [],
            id,
            isFirstParty: !!payload.isFirstParty,
            logoUri: payload.logo_uri,
            name: payload.name,
            policyUri: payload.policy_uri,
            redirectUris: payload.redirectUris || [],
            responseTypes: payload.response_types || [],
            scopes: Array.isArray(payload.scopes)
              ? payload.scopes
              : payload.scope
                ? payload.scope.split(' ')
                : [],
            tokenEndpointAuthMethod: payload.token_endpoint_auth_method,
            tosUri: payload.tos_uri,
          } as any)
          .onConflictDoUpdate({
            set: {
              applicationType: payload.application_type,
              clientSecret: payload.clientSecret,
              clientUri: payload.client_uri,
              description: payload.description,
              grants: payload.grant_types || [],
              isFirstParty: !!payload.isFirstParty,
              logoUri: payload.logo_uri,
              name: payload.name,
              policyUri: payload.policy_uri,
              redirectUris: payload.redirectUris || [],
              responseTypes: payload.response_types || [],
              scopes: payload.scope ? payload.scope.split(' ') : [],
              tokenEndpointAuthMethod: payload.token_endpoint_auth_method,
              tosUri: payload.tos_uri,
            } as any,
            target: (table as any).id,
          });
        log('[Client] Successfully upserted client: %s', id);
      } catch (error) {
        log('[Client] ERROR upserting client: %O', error);
        throw error;
      }
      return;
    }

    // 对其他模型，保存完整数据和元数据
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
    log('[%s] expiresAt set to: %s', this.name, expiresAt ? expiresAt.toISOString() : 'undefined');

    const record: Record<string, any> = {
      data: payload,
      expiresAt,
      id,
    };

    // 添加特定字段
    if (payload.accountId) {
      record.userId = payload.accountId;
      log('[%s] Setting userId: %s', this.name, payload.accountId);
    } else {
      try {
        const { getUserAuth } = await import('@lobechat/utils/server');
        try {
          const { userId } = await getUserAuth();
          if (userId) {
            payload.accountId = userId;
            record.userId = userId;
            log('[%s] Setting userId from auth context: %s', this.name, userId);
          }
        } catch (authError) {
          log('[%s] Error getting userId from auth context: %O', this.name, authError);
          // 如果获取 userId 失败，继续处理而不抛出错误
        }
      } catch (importError) {
        log('[%s] Error importing auth module: %O', this.name, importError);
        // 如果导入模块失败，继续处理而不抛出错误
      }
    }

    if (payload.clientId) {
      record.clientId = payload.clientId;
      log('[%s] Setting clientId: %s', this.name, payload.clientId);
    }

    if (payload.grantId) {
      record.grantId = payload.grantId;
      log('[%s] Setting grantId: %s', this.name, payload.grantId);
    }

    if (this.name === 'DeviceCode' && payload.userCode) {
      record.userCode = payload.userCode;
      log('[DeviceCode] Setting userCode: %s', payload.userCode);
    }

    try {
      log('[%s] Executing upsert DB operation', this.name);

      await this.db
        .insert(table)
        .values(record as any)
        .onConflictDoUpdate({
          set: {
            data: payload,
            expiresAt,
            ...(payload.accountId ? { userId: payload.accountId } : {}),
            ...(payload.clientId ? { clientId: payload.clientId } : {}),
            ...(payload.grantId ? { grantId: payload.grantId } : {}),
            ...(this.name === 'DeviceCode' && payload.userCode
              ? { userCode: payload.userCode }
              : {}),
          } as any,
          target: (table as any).id,
        });
      log('[%s] Successfully upserted record: %s', this.name, id);
    } catch (error) {
      log('[%s] ERROR upserting record: %O', this.name, error);
      console.error(`[OIDC Adapter] Error upserting ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 查找模型实例
   */
  async find(id: string): Promise<any> {
    log('[%s] find called - id: %s', this.name, id);

    const table = this.getTable();
    if (!table) {
      log('[%s] find - No table for model, returning undefined', this.name);
      return undefined;
    }

    try {
      log('[%s] Executing find DB query', this.name);
      const result = await this.db
        .select()
        .from(table)
        .where(eq((table as any).id, id))
        .limit(1);

      log('[%s] Find query results: %O', this.name, result);

      if (!result || result.length === 0) {
        log('[%s] No record found for id: %s', this.name, id);
        return undefined;
      }

      const model = result[0] as any;

      // 客户端模型特殊处理
      if (this.name === 'Client') {
        log('[Client] Converting client record to expected format');
        return {
          application_type: model.applicationType,
          client_id: model.id,
          client_secret: model.clientSecret,
          client_uri: model.clientUri,
          grant_types: model.grants,
          isFirstParty: model.isFirstParty,
          logo_uri: model.logoUri,
          policy_uri: model.policyUri,
          redirect_uris: model.redirectUris,
          response_types: model.responseTypes,
          scope: model.scopes.join(' '),
          token_endpoint_auth_method: model.tokenEndpointAuthMethod,
          tos_uri: model.tosUri,
        };
      }

      // 如果记录已过期，返回 undefined
      if (model.expiresAt && new Date() > new Date(model.expiresAt)) {
        log('[%s] Record expired (expiresAt: %s), returning undefined', this.name, model.expiresAt);
        return undefined;
      }

      // 如果记录已被消费，检查是否在宽限期内
      if (model.consumedAt) {
        // For RefreshToken, allow reuse within grace period
        if (this.name === 'RefreshToken') {
          const consumedAt = new Date(model.consumedAt);
          const gracePeriodEnd = new Date(
            consumedAt.getTime() + REFRESH_TOKEN_GRACE_PERIOD_SECONDS * 1000,
          );
          const now = new Date();

          if (now <= gracePeriodEnd) {
            // Within grace period, allow reuse for retry scenarios
            log(
              '[RefreshToken] Token consumed at %s but within grace period (ends %s), allowing reuse',
              consumedAt.toISOString(),
              gracePeriodEnd.toISOString(),
            );
            return model.data;
          }

          log(
            '[RefreshToken] Token consumed at %s, grace period expired at %s, returning undefined',
            consumedAt.toISOString(),
            gracePeriodEnd.toISOString(),
          );
          return undefined;
        }

        // For other token types, consumed means invalid
        log(
          '[%s] Record already consumed (consumedAt: %s), returning undefined',
          this.name,
          model.consumedAt,
        );
        return undefined;
      }

      log('[%s] Successfully found and returning record data', this.name);
      return model.data;
    } catch (error) {
      log('[%s] ERROR finding record: %O', this.name, error);
      console.error(`[OIDC Adapter] Error finding ${this.name}:`, error);
      return undefined;
    }
  }

  /**
   * 查找模型实例 by userCode (仅用于设备流程)
   */
  async findByUserCode(userCode: string): Promise<any> {
    log('[DeviceCode] findByUserCode called - userCode: %s', userCode);

    if (this.name !== 'DeviceCode') {
      const error = 'findByUserCode 只能用于 DeviceCode 模型';
      log('ERROR: %s', error);
      throw new Error(error);
    }

    try {
      log('[DeviceCode] Executing findByUserCode DB query');
      const result = await this.db
        .select()
        .from(oidcDeviceCodes)
        .where(eq(oidcDeviceCodes.userCode, userCode))
        .limit(1);

      log('[DeviceCode] findByUserCode query results: %O', result);

      if (!result || result.length === 0) {
        log('[DeviceCode] No record found for userCode: %s', userCode);
        return undefined;
      }

      const model = result[0];

      // 如果记录已过期或已被消费，返回 undefined
      if (model.expiresAt && new Date() > new Date(model.expiresAt)) {
        log('[DeviceCode] Record expired (expiresAt: %s), returning undefined', model.expiresAt);
        return undefined;
      }

      if (model.consumedAt) {
        log(
          '[DeviceCode] Record already consumed (consumedAt: %s), returning undefined',
          model.consumedAt,
        );
        return undefined;
      }

      log('[DeviceCode] Successfully found and returning record data by userCode');
      return model.data;
    } catch (error) {
      log('[DeviceCode] ERROR finding record by userCode: %O', error);
      console.error('[OIDC Adapter] Error finding DeviceCode by userCode:', error);
      return undefined;
    }
  }

  /**
   * 查找交互实例 by uid
   */
  async findByUid(uid: string): Promise<any> {
    log('[Interaction] findByUid called - uid: %s', uid);
    const table = this.getTable();
    if (this.name === 'Session') {
      try {
        const jsonbUidEq = sql`${(table as any).data}->>'uid' = ${uid}`;
        // @ts-ignore
        const results = await this.db.select().from(table).where(jsonbUidEq).limit(1);
        log('[Session] Find by data.uid query results: %O', results);

        if (!results || results.length === 0) {
          log('[Session] No record found by data.uid: %s', uid);
          return undefined;
        }

        const model = results[0] as any;
        // 检查过期
        if (model.expiresAt && model.expiresAt < new Date()) {
          log('[Session] Record found by data.uid but expired: %s', uid);
          await this.destroy(model.id); // 仍然使用主键 id 删除
          return undefined;
        }

        log('[Session] Successfully found by data.uid and returning record data for uid %s', uid);
        return model.data;
      } catch (error) {
        log('[Session] ERROR during findSessionByUid operation for %s: %O', uid, error);
        console.error(`[OIDC Adapter] Error finding Session by uid:`, error);
      }
    }
    // 复用 find 方法实现
    log('[Interaction] Delegating to find() method');
    return this.find(uid);
  }

  /**
   * 根据用户 ID 查找会话
   * 用于会话预同步
   */
  async findSessionByUserId(userId: string): Promise<any> {
    log('[%s] findSessionByUserId called - userId: %s', this.name, userId);

    if (this.name !== 'Session') {
      log('[%s] findSessionByUserId - Not a Session model, returning undefined', this.name);
      return undefined;
    }

    const table = this.getTable();
    if (!table) {
      log('[%s] findSessionByUserId - No table for model, returning undefined', this.name);
      return undefined;
    }

    try {
      log('[%s] Executing findSessionByUserId DB query', this.name);
      const result = await this.db
        .select()
        .from(table)
        .where(eq((table as any).userId, userId))
        .limit(1);

      log('[%s] findSessionByUserId query results: %O', this.name, result);

      if (!result || result.length === 0) {
        log('[%s] No session found for userId: %s', this.name, userId);
        return undefined;
      }

      return (result[0] as { data: any }).data;
    } catch (error) {
      log('[%s] ERROR finding session by userId: %O', this.name, error);
      console.error(`[OIDC Adapter] Error finding session by userId:`, error);
      return undefined;
    }
  }

  /**
   * 销毁模型实例
   */
  async destroy(id: string): Promise<void> {
    log('[%s] destroy called - id: %s', this.name, id);

    const table = this.getTable();
    if (!table) {
      log('[%s] destroy - No table for model, returning early', this.name);
      return;
    }

    try {
      log('[%s] Executing destroy DB operation', this.name);
      await this.db.delete(table).where(eq((table as any).id, id));
      log('[%s] Successfully destroyed record: %s', this.name, id);
    } catch (error) {
      log('[%s] ERROR destroying record: %O', this.name, error);
      console.error(`[OIDC Adapter] Error destroying ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 标记模型实例为已消费
   */
  async consume(id: string): Promise<void> {
    log('[%s] consume called - id: %s', this.name, id);

    const table = this.getTable();
    if (!table) {
      log('[%s] consume - No table for model, returning early', this.name);
      return;
    }

    try {
      log('[%s] Executing consume DB operation', this.name);
      await this.db
        .update(table)
        // @ts-ignore
        .set({ consumedAt: new Date() })
        .where(eq((table as any).id, id));
      log('[%s] Successfully consumed record: %s', this.name, id);
    } catch (error) {
      log('[%s] ERROR consuming record: %O', this.name, error);
      console.error(`[OIDC Adapter] Error consuming ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 根据 grantId 撤销所有相关模型实例
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    log('[%s] revokeByGrantId called - grantId: %s', this.name, grantId);

    // Grants 本身不需要通过 grantId 来撤销
    if (this.name === 'Grant') {
      log('[Grant] revokeByGrantId skipped for Grant model, as it is the grant itself');
      return;
    }

    // 提前检查模型名称是否有效，即使后续不直接使用 table
    this.getTable();

    try {
      log('[%s] Starting transaction for revokeByGrantId operations', this.name);

      // 使用事务删除所有包含grantId的记录，确保原子性
      await this.db.transaction(async (tx) => {
        // 所有可能包含grantId的表
        const tables = [
          oidcAccessTokens,
          oidcAuthorizationCodes,
          oidcRefreshTokens,
          oidcDeviceCodes,
        ];

        for (const table of tables) {
          if ('grantId' in table) {
            log('[%s] Revoking %s records by grantId: %s', this.name, grantId);
            await tx.delete(table).where(eq((table as any).grantId, grantId));
          }
        }
      });

      log(
        '[%s] Successfully completed transaction for revoking all records by grantId: %s',
        this.name,
        grantId,
      );
    } catch (error) {
      log('[%s] ERROR in revokeByGrantId transaction: %O', this.name, error);
      console.error(`[OIDC Adapter] Error in revokeByGrantId transaction:`, error);
      throw error;
    }
  }

  /**
   * 创建适配器工厂
   */
  static createAdapterFactory = (db: LobeChatDatabase) => {
    log('Creating adapter factory with database instance');
    return (name: string) => new OIDCAdapter(name, db);
  };
}

export { OIDCAdapter as DrizzleAdapter };
