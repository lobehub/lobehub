import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ModelOpsService } from '../services/model-ops.service';
import { ProviderOpsService } from '../services/provider-ops.service';
import type {
  BatchModelsRequest,
  ModelReasoningConfig,
  ReorderModelsRequest,
} from '../types/model-ops.type';
import type {
  CheckProviderRequest,
  ReorderProvidersRequest,
  UpdateProviderConfigRequest,
} from '../types/provider-ops.type';

type ModelParams = { modelId: string; providerId: string };

/** Model bulk / order / reasoning-config and provider check / remote / config / order. */
export class AiInfraOpsController extends BaseController {
  private async modelService(c: Context) {
    return new ModelOpsService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  private async providerService(c: Context) {
    return new ProviderOpsService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  async deleteModel(c: Context) {
    try {
      const { modelId, providerId } = this.getParams<ModelParams>(c);
      const result = await (await this.modelService(c)).deleteModel(providerId, modelId);
      return this.success(c, result, 'Model deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async batchModels(c: Context) {
    try {
      const body = await this.getBody<BatchModelsRequest>(c);
      const result = await (await this.modelService(c)).batch(body);
      return this.success(c, result, 'Models updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async reorderModels(c: Context) {
    try {
      const body = await this.getBody<ReorderModelsRequest>(c);
      const result = await (await this.modelService(c)).reorder(body);
      return this.success(c, result, 'Model order updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getReasoningConfig(c: Context) {
    try {
      const { modelId, providerId } = this.getParams<ModelParams>(c);
      const result = await (await this.modelService(c)).getReasoningConfig(providerId, modelId);
      return this.success(c, result, 'Reasoning config retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateReasoningConfig(c: Context) {
    try {
      const { modelId, providerId } = this.getParams<ModelParams>(c);
      const body = await this.getBody<ModelReasoningConfig>(c);
      const result = await (
        await this.modelService(c)
      ).updateReasoningConfig(providerId, modelId, body);
      return this.success(c, result, 'Reasoning config updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async checkProvider(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<CheckProviderRequest>(c);
      const result = await (await this.providerService(c)).checkProvider(id, body ?? {});
      return this.success(c, result, 'Provider check finished');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listRemoteModels(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const result = await (await this.providerService(c)).listRemoteModels(id);
      return this.success(c, result, 'Remote models retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateProviderConfig(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateProviderConfigRequest>(c);
      const result = await (await this.providerService(c)).updateConfig(id, body);
      return this.success(c, result, 'Provider config updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async reorderProviders(c: Context) {
    try {
      const body = await this.getBody<ReorderProvidersRequest>(c);
      const result = await (await this.providerService(c)).reorder(body);
      return this.success(c, result, 'Provider order updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
