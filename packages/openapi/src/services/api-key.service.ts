import { canUseWorkspaceApiKeys } from '@/business/server/workspaceApiKey';
import { ApiKeyModel } from '@/database/models/apiKey';
import type { ApiKeyItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type {
  ApiKeyResponse,
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
  UpdateApiKeyRequest,
} from '../types/api-key.type';

const projectApiKey = (value: ApiKeyItem): ApiKeyResponse => ({
  createdAt: value.createdAt,
  enabled: value.enabled,
  expiresAt: value.expiresAt,
  id: value.id,
  lastUsedAt: value.lastUsedAt,
  name: value.name,
  scopes: value.scopes,
  updatedAt: value.updatedAt,
});

export class ApiKeyService extends BaseService {
  private apiKeyModel: ApiKeyModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.apiKeyModel = new ApiKeyModel(db, userId, workspaceId);
  }

  async createApiKey(request: CreateApiKeyRequest): Promise<CreatedApiKeyResponse> {
    if (this.workspaceId && !(await canUseWorkspaceApiKeys(this.workspaceId))) {
      throw this.createBusinessError('Workspace API Key access is not available');
    }

    const created = await this.apiKeyModel.createWithPlaintext(request);
    return { ...projectApiKey(created), key: created.key };
  }

  async getApiKeys(): Promise<ApiKeyResponse[]> {
    const rows = await this.apiKeyModel.queryMetadata();
    return rows.map(projectApiKey);
  }

  async getApiKey(id: string): Promise<ApiKeyResponse> {
    const apiKey = await this.apiKeyModel.findById(id);
    if (!apiKey) throw this.createNotFoundError('API key not found');
    return projectApiKey(apiKey);
  }

  async updateApiKey(id: string, request: UpdateApiKeyRequest): Promise<ApiKeyResponse> {
    const existing = await this.apiKeyModel.findById(id);
    if (!existing) throw this.createNotFoundError('API key not found');

    await this.apiKeyModel.update(id, request);
    return this.getApiKey(id);
  }

  async deleteApiKey(id: string): Promise<{ id: string }> {
    const existing = await this.apiKeyModel.findById(id);
    if (!existing) throw this.createNotFoundError('API key not found');

    await this.apiKeyModel.delete(id);
    return { id };
  }
}
