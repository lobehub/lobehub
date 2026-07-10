import {
  type UserPersonaDocument,
  type UserPersonaDocumentHistoriesItem,
} from '@lobechat/database/schemas';
import { userMemories } from '@lobechat/database/schemas';
import { type UserPersonaExtractionResult } from '@lobechat/memory-user-memory';
import {
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
  UserPersonaExtractor,
} from '@lobechat/memory-user-memory';
import type { UserServiceModelConfig } from '@lobechat/types';
import { desc, eq } from 'drizzle-orm';

import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { UserModel } from '@/database/models/user';
import { UserMemoryModel } from '@/database/models/userMemory';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { type LobeChatDatabase } from '@/database/type';
import { type MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  type ProviderKeyVaultMap,
  type RuntimeResolveOptions,
} from '@/server/services/memory/userMemory/extract';
import { resolveRuntimeAgentConfig } from '@/server/services/memory/userMemory/extract';
import { LayersEnum } from '@/types/userMemory';
import { trimBasedOnBatchProbe } from '@/utils/chunkers';

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
  username?: string;
  userProfile?: string;
}

interface UserPersonaAgentResult {
  agentResult: UserPersonaExtractionResult;
  diff?: UserPersonaDocumentHistoriesItem;
  document: UserPersonaDocument;
}

const resolvePositiveInteger = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;

  return Math.floor(value);
};

const normalizeProvider = (provider: string) => provider.toLowerCase();

export class UserPersonaService {
  private readonly preferredLanguage?: string;
  private readonly db: LobeChatDatabase;
  private readonly agentConfig: MemoryAgentConfig;

  constructor(db: LobeChatDatabase) {
    const { agentPersonaWriter } = parseMemoryExtractionConfig();

    this.db = db;
    this.preferredLanguage = agentPersonaWriter.language;
    this.agentConfig = agentPersonaWriter;
  }

  private async resolveAgentConfig(userId: string): Promise<MemoryAgentConfig> {
    const userModel = new UserModel(this.db, userId);
    const settings = await userModel.getUserSettings();
    const userMemoryPersonaWriter = (
      settings?.systemAgent as Partial<UserServiceModelConfig> | undefined
    )?.userMemoryPersonaWriter;
    const provider = userMemoryPersonaWriter?.provider || this.agentConfig.provider;
    const shouldInheritCredentials =
      !userMemoryPersonaWriter?.provider ||
      normalizeProvider(userMemoryPersonaWriter.provider) ===
        normalizeProvider(this.agentConfig.provider || 'openai');

    return {
      apiKey: shouldInheritCredentials ? this.agentConfig.apiKey : undefined,
      baseURL: shouldInheritCredentials ? this.agentConfig.baseURL : undefined,
      contextLimit:
        resolvePositiveInteger(userMemoryPersonaWriter?.contextLimit) ??
        this.agentConfig.contextLimit,
      language: this.agentConfig.language,
      model: userMemoryPersonaWriter?.model || this.agentConfig.model,
      provider,
    };
  }

  async composeWriting(payload: UserPersonaAgentPayload): Promise<UserPersonaAgentResult> {
    const agentConfig = await this.resolveAgentConfig(payload.userId);
    // workspace-audit: intentionally personal-scoped (no workspaceId). Persona is a
    // purely user-level feature with no workspace concept; the payload carries no
    // workspaceId, so provider config is resolved against the user's personal scope.
    const aiInfraRepos = new AiInfraRepos(this.db, payload.userId, {});
    const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: agentConfig.provider,
      label: 'persona writer',
      modelId: agentConfig.model,
    });

    const keyVaults: ProviderKeyVaultMap = Object.entries(runtimeState.runtimeConfig || {}).reduce(
      (acc, [provider, config]) => {
        acc[provider.toLowerCase()] = config?.keyVaults;
        return acc;
      },
      {} as ProviderKeyVaultMap,
    );

    const hooks = getBusinessModelRuntimeHooks(payload.userId, 'lobehub');

    const runtime = await resolveRuntimeAgentConfig(
      agentConfig,
      keyVaults,
      {
        fallback: {
          apiKey: agentConfig.apiKey,
          baseURL: agentConfig.baseURL,
        },
        preferred: { providerIds: [providerId] },
        userId: payload.userId,
      } satisfies RuntimeResolveOptions,
      hooks,
    );

    const personaModel = new UserPersonaModel(this.db, payload.userId);
    const lastDocument = await personaModel.getLatestPersonaDocument();
    const existingPersonaBaseline = payload.existingPersona ?? lastDocument?.persona;

    const extractor = new UserPersonaExtractor({
      agent: 'user-persona',
      model: agentConfig.model,
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
  const userModel = new UserModel(db, userId);
  const settings = await userModel.getUserSettings();
  const userMemoryPersonaWriter = (
    settings?.systemAgent as Partial<UserServiceModelConfig> | undefined
  )?.userMemoryPersonaWriter;
  const personaContextLimit =
    resolvePositiveInteger(userMemoryPersonaWriter?.contextLimit) ??
    agentPersonaWriter.contextLimit;

  const userMemoryModel = new UserMemoryModel(db, userId);

  const [identities, activities, contexts, preferences, memories] = await Promise.all([
    userMemoryModel.getAllIdentitiesWithMemory(),
    // TODO(@nekomeowww): @arvinxx kindly take some time to review this policy
    userMemoryModel.listMemories({ layer: LayersEnum.Activity, pageSize: 3 }),
    userMemoryModel.listMemories({ layer: LayersEnum.Context, pageSize: 3 }),
    userMemoryModel.listMemories({ layer: LayersEnum.Preference, pageSize: 10 }),
    db.query.userMemories.findMany({
      limit: 20,
      orderBy: [desc(userMemories.capturedAt)],
      where: eq(userMemories.userId, userId),
    }),
  ]);

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
    memoryIds: memories.map((m) => m.id),
    retrievedMemories: assembledContext || undefined,
  };
};
