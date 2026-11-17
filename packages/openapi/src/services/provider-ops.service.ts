import { TRPCError } from '@trpc/server';
import { and, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { AiProviderModel } from '@/database/models/aiProvider';
import { aiProviders } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeForRequest } from '@/server/modules/AgentRuntime/llmRelay/oneShot';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';

import { BaseService } from '../common/base.service';
import type {
  CheckProviderRequest,
  ProviderCheckResult,
  ProviderConfigResult,
  RemoteModel,
  RemoteModelList,
  ReorderProvidersRequest,
  UpdateProviderConfigRequest,
} from '../types/provider-ops.type';
import { RemoteModelSchema } from '../types/provider-ops.type';
import { describeRelayFailure } from './heterogeneous-direct.service';

const BUILTIN_PROVIDER_IDS = new Set(DEFAULT_MODEL_PROVIDER_LIST.map((card) => card.id));

const REMOTE_MODEL_FIELDS = Object.keys(RemoteModelSchema.shape) as (keyof RemoteModel)[];

/** Keep only the documented card fields that hold a valid value. */
const projectRemoteModel = (card: Record<string, unknown>): RemoteModel | undefined => {
  if (typeof card?.id !== 'string') return;
  const picked: Record<string, unknown> = {};
  for (const field of REMOTE_MODEL_FIELDS) {
    if (card[field] === undefined || card[field] === null) continue;
    const parsed = RemoteModelSchema.shape[field].safeParse(card[field]);
    if (parsed.success) picked[field] = parsed.data;
  }
  return picked as RemoteModel;
};

const stringify = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * Provider operations that act on credentials or call the provider: the
 * connectivity check, the remote model list, the credential/config write and
 * the provider order.
 *
 * Writes and the check go through the tRPC `aiProvider` procedures the
 * provider settings page calls (invoked server-side without API-key scopes —
 * the REST gate has already narrowed the key), so the workspace admin gate,
 * keyVault encryption/merge and check-mode selection stay in one place.
 *
 * A provider id is addressable when the caller's scope (personal, or the
 * `X-Workspace-Id` workspace) holds a row for it, or it is one of the built-in
 * providers every account can configure. Anything else — another user's or
 * another workspace's custom provider included — is 404.
 */
export class ProviderOpsService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get providers() {
    return aiProviderRouter.createCaller(this.ctx);
  }

  /** Server guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError || error instanceof HTTPException) throw error;
    this.handleServiceError(error, operation);
  }

  /** Throws 404 for every id in `ids` the caller cannot address. */
  async assertProvidersKnown(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const custom = unique.filter((id) => !BUILTIN_PROVIDER_IDS.has(id));
    if (custom.length === 0) return;

    const rows = await this.db
      .select({ id: aiProviders.id })
      .from(aiProviders)
      .where(and(inArray(aiProviders.id, custom), this.buildWorkspaceWhere(aiProviders)));
    const found = new Set(rows.map((row) => row.id));
    const missing = custom.filter((id) => !found.has(id));

    if (missing.length > 0) {
      throw this.createNotFoundError(`Provider not found: ${missing.join(', ')}`);
    }
  }

  async checkProvider(id: string, request: CheckProviderRequest): Promise<ProviderCheckResult> {
    try {
      await this.assertProvidersKnown([id]);
      const result = (await this.providers.checkProviderConnectivity({
        id,
        model: request.model,
      })) as Record<string, unknown>;

      const check: ProviderCheckResult = { ok: result.ok === true };
      const error = stringify(result.error);
      if (error) check.error = error;
      if (typeof result.errorType === 'string') check.errorType = result.errorType;
      if (typeof result.model === 'string') check.model = result.model;
      if (typeof result.status === 'number') check.status = result.status;
      if (typeof result.balance === 'number') check.balance = result.balance;
      return check;
    } catch (error) {
      this.fail(error, 'check provider connectivity');
    }
  }

  /**
   * The provider's own model list, fetched with the caller's stored
   * credentials — the same call `GET /webapi/models/{provider}` makes. A
   * provider only the user's device can reach has no browser tab to relay
   * through here, so it reports the runtime's error.
   */
  async listRemoteModels(id: string): Promise<RemoteModelList> {
    try {
      await this.assertProvidersKnown([id]);
    } catch (error) {
      this.fail(error, 'list remote models');
    }

    let cards: unknown;
    try {
      const runtime = await initModelRuntimeForRequest(this.db, this.userId, id, {
        workspaceId: this.workspaceId,
      });
      cards = await runtime.models();
    } catch (error) {
      const { message, status } = describeRelayFailure(error);
      throw new HTTPException(status, { message });
    }

    const models = (Array.isArray(cards) ? cards : [])
      .map((card) => projectRemoteModel(card as Record<string, unknown>))
      .filter((card): card is RemoteModel => !!card);

    return { models, providerId: id };
  }

  async updateConfig(
    id: string,
    request: UpdateProviderConfigRequest,
  ): Promise<ProviderConfigResult> {
    try {
      await this.assertProvidersKnown([id]);
      await this.providers.updateAiProviderConfig({ id, value: request });

      const model = new AiProviderModel(this.db, this.userId, this.workspaceId);
      const detail = await model.getAiProviderById(id, KeyVaultsGateKeeper.getUserKeyVaults);
      const keyVaultFields = Object.entries(detail?.keyVaults ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([field]) => field)
        .sort();
      const enableResponseApi = (detail?.config as { enableResponseApi?: unknown } | undefined)
        ?.enableResponseApi;

      return {
        checkModel: detail?.checkModel ?? null,
        config: typeof enableResponseApi === 'boolean' ? { enableResponseApi } : {},
        fetchOnClient: detail?.fetchOnClient ?? null,
        hasKeyVaults: keyVaultFields.length > 0,
        id,
        keyVaultFields,
      };
    } catch (error) {
      this.fail(error, 'update provider config');
    }
  }

  async reorder(request: ReorderProvidersRequest): Promise<{ providerIds: string[] }> {
    try {
      await this.assertProvidersKnown(request.sortMap.map((item) => item.id));
      await this.providers.updateAiProviderOrder({ sortMap: request.sortMap });

      const providerIds = [...request.sortMap]
        .sort((a, b) => a.sort - b.sort)
        .map((item) => item.id);
      return { providerIds: [...new Set(providerIds)] };
    } catch (error) {
      this.fail(error, 'reorder providers');
    }
  }
}

/** Shared by the model operations: models live under an addressable provider. */
export const assertProviderKnown = (
  db: LobeChatDatabase,
  userId: string | null,
  workspaceId: string | undefined,
  providerId: string,
) => new ProviderOpsService(db, userId, workspaceId).assertProvidersKnown([providerId]);
