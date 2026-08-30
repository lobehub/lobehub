import { isOfficialProvider, OFFICIAL_PROVIDER_DISABLE_ERROR } from '@lobechat/business-const';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import type { AiProviderSelectItem } from '@/database/schemas';
import { aiModels, aiProviders } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import { projectPublicProvider } from '../helpers/public-fields';
import type { ServiceResult } from '../types';
import type {
  CreateProviderRequest,
  DeleteProviderRequest,
  GetProviderDetailRequest,
  GetProvidersResponse,
  ProviderDetailResponse,
  ProviderKeyVaults,
  ProviderListQuery,
  UpdateProviderRequest,
} from '../types/provider.type';

/**
 * Provider service implementation class, responsible for handling AI Provider business logic
 */
export class ProviderService extends BaseService {
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private async getGateKeeper(): Promise<KeyVaultsGateKeeper> {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }

    return this.gateKeeperPromise;
  }

  private async encryptKeyVaults(
    keyVaults: ProviderKeyVaults | null | undefined,
  ): Promise<string | null | undefined> {
    if (keyVaults === undefined) return undefined;
    if (keyVaults === null) return null;

    const gateKeeper = await this.getGateKeeper();

    return gateKeeper.encrypt(JSON.stringify(keyVaults));
  }

  private async decryptKeyVaults(encrypted: string | null): Promise<ProviderKeyVaults | undefined> {
    if (!encrypted) return undefined;

    try {
      const gateKeeper = await this.getGateKeeper();
      const { plaintext, wasAuthentic } = await gateKeeper.decrypt(encrypted);

      if (!wasAuthentic || !plaintext) return undefined;

      const parsed = JSON.parse(plaintext);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ProviderKeyVaults;
      }

      return undefined;
    } catch (error) {
      this.log('warn', 'Failed to decrypt Provider KeyVaults', {
        error,
      });
      return undefined;
    }
  }

  private async transformProviderRecord(
    provider: AiProviderSelectItem,
  ): Promise<ProviderDetailResponse> {
    return projectPublicProvider(provider);
  }

  async getProviders(request: ProviderListQuery = {}): ServiceResult<GetProvidersResponse> {
    this.log('info', 'Get Provider list', {
      request,
      userId: this.userId,
    });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_PROVIDER_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to access Provider list');
      }

      const conditions = [] as any[];

      const permissionWhere = this.buildPermissionWhere(aiProviders, permissionResult.condition);
      if (permissionWhere) conditions.push(permissionWhere);

      if (request.keyword) {
        conditions.push(
          or(
            ilike(aiProviders.id, `%${request.keyword}%`),
            ilike(aiProviders.name, `%${request.keyword}%`),
            ilike(aiProviders.description, `%${request.keyword}%`),
          ),
        );
      }

      if (typeof request.enabled === 'boolean') {
        conditions.push(eq(aiProviders.enabled, request.enabled));
      }

      const whereCondition =
        conditions.length > 1 ? and(...conditions) : (conditions[0] ?? undefined);

      const { limit, offset } = processPaginationConditions(request);

      const [providers, totalResult] = await Promise.all([
        this.db.query.aiProviders.findMany({
          limit,
          offset,
          orderBy: [asc(aiProviders.sort), desc(aiProviders.updatedAt)],
          where: whereCondition,
        }),
        this.db.select({ count: count() }).from(aiProviders).where(whereCondition),
      ]);

      const sanitizedProviders = await Promise.all(
        providers.map((provider) => this.transformProviderRecord(provider)),
      );

      return {
        providers: sanitizedProviders,
        total: totalResult[0]?.count ?? 0,
      };
    } catch (error) {
      this.handleServiceError(error, 'Get Provider list');
    }
  }

  async getProviderDetail(
    request: GetProviderDetailRequest,
  ): ServiceResult<ProviderDetailResponse> {
    this.log('info', 'Get Provider detail', {
      id: request.id,
      userId: this.userId,
    });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_PROVIDER_READ', {
        targetProviderId: request.id,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to access Provider detail');
      }

      const whereConditions = [eq(aiProviders.id, request.id)];

      const permissionWhere = this.buildPermissionWhere(aiProviders, permissionResult.condition);
      if (permissionWhere) whereConditions.push(permissionWhere);

      const whereCondition =
        whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0];

      const provider = await this.db.query.aiProviders.findFirst({
        where: whereCondition,
      });

      if (!provider) {
        throw this.createNotFoundError(`Provider not found: ${request.id}`);
      }

      return await this.transformProviderRecord(provider);
    } catch (error) {
      this.handleServiceError(error, 'Get Provider detail');
    }
  }

  async createProvider(request: CreateProviderRequest): ServiceResult<ProviderDetailResponse> {
    this.log('info', 'Create Provider', {
      id: request.id,
      userId: this.userId,
    });

    try {
      if (isOfficialProvider(request.id) && request.enabled === false) {
        throw this.createBusinessError(OFFICIAL_PROVIDER_DISABLE_ERROR);
      }

      const permissionResult = await this.resolveOperationPermission('AI_PROVIDER_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to create Provider');
      }

      const existed = await this.db.query.aiProviders.findFirst({
        where: and(eq(aiProviders.id, request.id), this.buildWorkspaceWhere(aiProviders)),
      });

      if (existed) {
        throw this.createBusinessError(`Provider "${request.id}" already exists`);
      }

      const encryptedKeyVaults = await this.encryptKeyVaults(request.keyVaults);
      const now = new Date();

      const [createdProvider] = await this.db
        .insert(aiProviders)
        .values({
          checkModel: request.checkModel ?? null,
          config: request.config ?? {},
          createdAt: now,
          description: request.description ?? null,
          enabled: request.enabled ?? true,
          fetchOnClient: request.fetchOnClient ?? null,
          id: request.id,
          keyVaults: encryptedKeyVaults ?? null,
          logo: request.logo ?? null,
          name: request.name ?? null,
          settings: request.settings ?? {},
          sort: request.sort ?? null,
          source: request.source,
          updatedAt: now,
          ...this.buildWorkspacePayload({}),
        })
        .returning();

      return await this.transformProviderRecord(createdProvider);
    } catch (error) {
      this.handleServiceError(error, 'Create Provider');
    }
  }

  async updateProvider(request: UpdateProviderRequest): ServiceResult<ProviderDetailResponse> {
    this.log('info', 'Update Provider', {
      id: request.id,
      userId: this.userId,
    });

    try {
      if (isOfficialProvider(request.id) && request.enabled === false) {
        throw this.createBusinessError(OFFICIAL_PROVIDER_DISABLE_ERROR);
      }

      const permissionResult = await this.resolveOperationPermission('AI_PROVIDER_UPDATE', {
        targetProviderId: request.id,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to update Provider');
      }

      const whereConditions = [eq(aiProviders.id, request.id)];

      const permissionWhere = this.buildPermissionWhere(aiProviders, permissionResult.condition);
      if (permissionWhere) whereConditions.push(permissionWhere);

      const whereCondition =
        whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0];

      const existing = await this.db.query.aiProviders.findFirst({
        where: whereCondition,
      });

      if (!existing) {
        throw this.createNotFoundError(`Provider not found: ${request.id}`);
      }

      const { id: _id, keyVaults, ...rest } = request;
      let encryptedKeyVaults: string | null | undefined;

      if (keyVaults === undefined) {
        encryptedKeyVaults = undefined;
      } else if (keyVaults === null) {
        encryptedKeyVaults = null;
      } else {
        const existingKeyVaults = await this.decryptKeyVaults(existing.keyVaults);
        const mergedKeyVaults = { ...existingKeyVaults, ...keyVaults };

        encryptedKeyVaults = await this.encryptKeyVaults(mergedKeyVaults);
      }

      const updateData: Partial<typeof aiProviders.$inferInsert> = {
        ...rest,
        ...(keyVaults !== undefined && { keyVaults: encryptedKeyVaults }),
      };

      const [updatedProvider] = await this.db
        .update(aiProviders)
        .set(updateData)
        .where(whereCondition)
        .returning();

      if (!updatedProvider) {
        throw this.createBusinessError('Failed to update Provider');
      }

      return await this.transformProviderRecord(updatedProvider);
    } catch (error) {
      this.handleServiceError(error, 'Update Provider');
    }
  }

  async deleteProvider(request: DeleteProviderRequest): ServiceResult<{ id: string }> {
    this.log('info', 'Delete Provider', {
      id: request.id,
      userId: this.userId,
    });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_PROVIDER_DELETE', {
        targetProviderId: request.id,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to delete Provider');
      }

      const whereConditions = [eq(aiProviders.id, request.id)];

      const permissionWhere = this.buildPermissionWhere(aiProviders, permissionResult.condition);
      if (permissionWhere) whereConditions.push(permissionWhere);

      const providerWhere =
        whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0]!;

      const provider = await this.db.query.aiProviders.findFirst({
        where: providerWhere,
      });

      if (!provider) {
        throw this.createNotFoundError(`Provider not found: ${request.id}`);
      }

      await this.db.transaction(async (tx) => {
        const modelConditions = [eq(aiModels.providerId, request.id)];

        const modelPermissionWhere = this.buildPermissionWhere(
          aiModels,
          permissionResult.condition,
        );
        if (modelPermissionWhere) modelConditions.push(modelPermissionWhere);

        const modelWhere =
          modelConditions.length > 1 ? and(...modelConditions) : modelConditions[0]!;

        await tx.delete(aiModels).where(modelWhere);
        await tx.delete(aiProviders).where(providerWhere);
      });

      this.log('info', 'Provider deleted successfully', {
        id: request.id,
      });

      return { id: request.id };
    } catch (error) {
      this.handleServiceError(error, 'Delete Provider');
    }
  }
}
