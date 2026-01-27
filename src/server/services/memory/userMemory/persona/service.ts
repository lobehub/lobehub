import type {
  UserPersonaDocument,
  UserPersonaDocumentHistoriesItem,
} from '@lobechat/database/schemas';
import {
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
  type UserPersonaExtractionResult,
  UserPersonaExtractor,
} from '@lobechat/memory-user-memory';
import { ModelRuntime } from '@lobechat/model-runtime';
import type { AiProviderRuntimeState } from '@lobechat/types';

import { UserMemoryModel } from '@/database/models/userMemory';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { LobeChatDatabase } from '@/database/type';
import { getServerGlobalConfig } from '@/server/globalConfig';
import {
  MemoryAgentConfig,
  parseMemoryExtractionConfig,
} from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { ProviderConfig } from '@/types/user/settings';
import { LayersEnum } from '@/types/userMemory';
import { trimBasedOnBatchProbe } from '@/utils/chunkers';

const normalizeProvider = (provider: string) => provider.toLowerCase();

const extractCredentialsFromVault = (vault?: Record<string, unknown>) => {
  if (!vault || typeof vault !== 'object') {
    return {};
  }

  const payload = vault as Record<string, string | undefined>;

  return {
    apiKey: payload.apiKey,
    baseURL: payload.baseURL,
  };
};

interface ProviderModelMap {
  [providerId: string]: Set<string>;
}

interface PersonaRuntimeConfig {
  apiKey?: string;
  baseURL?: string;
  provider: string;
}

interface UserPersonaAgentPayload {
  existingPersona?: string | null;
  language?: string;
  memoryIds?: string[];
  metadata?: Record<string, unknown>;
  personaNotes?: string;
  recentEvents?: string;
  retrievedMemories?: string;
  sourceIds?: string[];
  userId: string;
  userProfile?: string;
  username?: string;
}

interface UserPersonaAgentResult {
  agentResult: UserPersonaExtractionResult;
  diff?: UserPersonaDocumentHistoriesItem;
  document: UserPersonaDocument;
}

export class UserPersonaService {
  private readonly preferredLanguage?: string;
  private readonly db: LobeChatDatabase;
  private readonly agentConfig: MemoryAgentConfig;
  private readonly preferredModels?: string[];
  private readonly preferredProviders?: string[];
  private readonly runtimeCache = new Map<string, ModelRuntime>();
  private readonly serverConfigPromise = getServerGlobalConfig();

  constructor(db: LobeChatDatabase) {
    const {
      agentPersonaWriter,
      agentPersonaWriterPreferredModels,
      agentPersonaWriterPreferredProviders,
    } = parseMemoryExtractionConfig();

    this.db = db;
    this.preferredLanguage = agentPersonaWriter.language;
    this.agentConfig = agentPersonaWriter;
    this.preferredModels = agentPersonaWriterPreferredModels;
    this.preferredProviders = agentPersonaWriterPreferredProviders;
  }

  private normalizeRuntimeState(runtimeState?: AiProviderRuntimeState) {
    const normalizedRuntimeConfig = Object.fromEntries(
      Object.entries(runtimeState?.runtimeConfig || {}).map(([providerId, config]) => [
        normalizeProvider(providerId),
        config,
      ]),
    );

    const providerModels = (runtimeState?.enabledAiModels || []).reduce<ProviderModelMap>(
      (acc, model) => {
        const providerId = normalizeProvider(model.providerId);
        acc[providerId] = acc[providerId] || new Set<string>();
        acc[providerId].add(model.id);
        return acc;
      },
      {},
    );

    return { normalizedRuntimeConfig, providerModels };
  }

  private resolveProviderForModel(modelId: string, providerModels: ProviderModelMap): string {
    const providerOrder = Array.from(
      new Set(
        [
          ...(this.preferredProviders || []),
          this.agentConfig.provider ? normalizeProvider(this.agentConfig.provider) : undefined,
          ...Object.keys(providerModels),
        ].filter(Boolean) as string[],
      ),
    );

    const candidateModels =
      this.preferredModels && this.preferredModels.length > 0 ? this.preferredModels : [];

    for (const providerId of providerOrder) {
      const models = providerModels[providerId];
      if (!models) continue;
      if (models.has(modelId)) return providerId;

      const preferredMatch = candidateModels.find((preferredModel) => models.has(preferredModel));
      if (preferredMatch) return providerId;
    }

    if (this.agentConfig.provider) return normalizeProvider(this.agentConfig.provider);

    throw new Error(
      `Unable to resolve provider for persona writer model "${modelId}". Check preferred providers/models configuration.`,
    );
  }

  private resolveCredentials(
    providerId: string,
    keyVault?: Record<string, unknown>,
  ): PersonaRuntimeConfig {
    const { apiKey: userApiKey, baseURL: userBaseURL } = extractCredentialsFromVault(keyVault);

    const useUserCredential = !!userApiKey;
    const apiKey = useUserCredential ? userApiKey : this.agentConfig.apiKey;
    const baseURL = useUserCredential
      ? userBaseURL || this.agentConfig.baseURL
      : this.agentConfig.baseURL;

    if (!apiKey) {
      throw new Error(`Missing API key for persona writer provider "${providerId}"`);
    }

    return {
      apiKey,
      baseURL,
      provider: providerId,
    };
  }

  private async initializeRuntime(userId: string): Promise<ModelRuntime> {
    try {
      const serverConfig = await this.serverConfigPromise;
      const aiProviderConfig = (serverConfig.aiProvider || {}) as Record<string, ProviderConfig>;

      const aiInfraRepos = new AiInfraRepos(this.db, userId, aiProviderConfig);
      const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
        KeyVaultsGateKeeper.getUserKeyVaults,
      );

      const { normalizedRuntimeConfig, providerModels } = this.normalizeRuntimeState(runtimeState);
      const providerId = this.resolveProviderForModel(this.agentConfig.model, providerModels);

      const resolved = this.resolveCredentials(
        providerId,
        normalizedRuntimeConfig[providerId]?.keyVaults as Record<string, unknown> | undefined,
      );

      return ModelRuntime.initializeWithProvider(resolved.provider, {
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
      });
    } catch (error) {
      console.warn(
        '[user-persona] failed to resolve runtime via user providers, falling back to server config',
        error,
      );

      const fallbackProvider = normalizeProvider(this.agentConfig.provider || 'openai');
      const resolved = this.resolveCredentials(fallbackProvider);

      return ModelRuntime.initializeWithProvider(resolved.provider, {
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
      });
    }
  }

  private async getRuntime(userId: string): Promise<ModelRuntime> {
    const cached = this.runtimeCache.get(userId);
    if (cached) return cached;

    const runtime = await this.initializeRuntime(userId);
    this.runtimeCache.set(userId, runtime);

    return runtime;
  }

  async composeWriting(payload: UserPersonaAgentPayload): Promise<UserPersonaAgentResult> {
    const personaModel = new UserPersonaModel(this.db, payload.userId);
    const lastDocument = await personaModel.getLatestPersonaDocument();
    const existingPersonaBaseline = payload.existingPersona ?? lastDocument?.persona;

    const runtime = await this.getRuntime(payload.userId);

    const extractor = new UserPersonaExtractor({
      agent: 'user-persona',
      model: this.agentConfig.model,
      modelRuntime: runtime,
    });

    const agentResult = await extractor.toolCall({
      existingPersona: existingPersonaBaseline || undefined,
      language: payload.language || this.preferredLanguage,
      personaNotes: payload.personaNotes,
      recentEvents: payload.recentEvents,
      retrievedMemories: payload.retrievedMemories,
      userProfile: payload.userProfile,
      username: payload.username,
    });

    const persisted = await personaModel.upsertPersona({
      capturedAt: new Date(),
      diffPersona: agentResult.diff ?? undefined,
      editedBy: 'agent',
      memoryIds: payload.memoryIds ?? agentResult.memoryIds ?? undefined,
      metadata: payload.metadata ?? undefined,
      persona: agentResult.persona,
      reasoning: agentResult.reasoning ?? undefined,
      snapshot: agentResult.persona,
      sourceIds: payload.sourceIds ?? agentResult.sourceIds ?? undefined,
      tagline: agentResult.tagline ?? undefined,
    });

    return { agentResult, ...persisted };
  }
}

export const buildUserPersonaJobInput = async (db: LobeChatDatabase, userId: string) => {
  const personaModel = new UserPersonaModel(db, userId);
  const latestPersona = await personaModel.getLatestPersonaDocument();
  const { agentPersonaWriter } = parseMemoryExtractionConfig();
  const personaContextLimit = agentPersonaWriter.contextLimit;

  const userMemoryModel = new UserMemoryModel(db, userId);

  const [identities, activities, contexts, preferences] = await Promise.all([
    userMemoryModel.getAllIdentitiesWithMemory(),
    // TODO(@nekomeowww): @arvinxx kindly take some time to review this policy
    userMemoryModel.listMemories({ layer: LayersEnum.Activity, pageSize: 3 }),
    userMemoryModel.listMemories({ layer: LayersEnum.Context, pageSize: 3 }),
    userMemoryModel.listMemories({ layer: LayersEnum.Preference, pageSize: 10 }),
  ]);

  const memoryIds: string[] = [];

  activities.forEach((a) => memoryIds.push(a.memory.id));
  contexts.forEach((c) => memoryIds.push(c.memory.id));
  preferences.forEach((p) => memoryIds.push(p.memory.id));

  const contextProvider = new RetrievalUserMemoryContextProvider({
    retrievedMemories: {
      activities: activities.map((a) => a.activity),
      contexts: contexts.map((c) => c.context),
      experiences: [],
      preferences: preferences.map((p) => p.preference),
    },
  });

  const identityProvider = new RetrievalUserMemoryIdentitiesProvider({
    retrievedIdentities: identities.map((i) => ({
      ...i,
      layer: LayersEnum.Identity,
    })),
  });

  const [recentMemoriesContext, allIdentitiesContext] = await Promise.all([
    contextProvider.buildContext(userId, 'user-persona-memories'),
    identityProvider.buildContext(userId, 'user-persona-memories-identities'),
  ]);

  const rawContext = [recentMemoriesContext.context, allIdentitiesContext.context]
    .filter(Boolean)
    .join('\n\n');

  const trimmedContext = rawContext
    ? await trimBasedOnBatchProbe(rawContext, personaContextLimit)
    : '';
  const assembledContext = trimmedContext?.trim();

  return {
    existingPersona: latestPersona?.persona || undefined,
    memoryIds,
    retrievedMemories: assembledContext || undefined,
  };
};
