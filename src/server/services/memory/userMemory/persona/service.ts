import type {
  UserPersonaDocument,
  UserPersonaDocumentHistoriesItem,
} from '@lobechat/database/schemas';
import { userMemories } from '@lobechat/database/schemas';
import {
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
  type UserPersonaExtractionResult,
  UserPersonaExtractor,
} from '@lobechat/memory-user-memory';
import { ModelRuntime } from '@lobechat/model-runtime';
import { desc, eq } from 'drizzle-orm';

import { UserMemoryModel } from '@/database/models/userMemory';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { LobeChatDatabase } from '@/database/type';
import {
  MemoryAgentConfig,
  parseMemoryExtractionConfig,
} from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { LayersEnum } from '@/types/userMemory';
import { trimBasedOnBatchProbe } from '@/utils/chunkers';

const extractCredentialsFromVault = (
  vault?: Record<string, unknown>,
): { apiKey?: string; baseURL?: string } => {
  if (!vault || typeof vault !== 'object') return {};

  const apiKey =
    'apiKey' in vault && typeof (vault as any).apiKey === 'string'
      ? (vault as any).apiKey
      : undefined;
  const baseURL =
    'baseURL' in vault && typeof (vault as any).baseURL === 'string'
      ? (vault as any).baseURL
      : undefined;

  return { apiKey, baseURL };
};

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

  constructor(db: LobeChatDatabase) {
    const { agentPersonaWriter } = parseMemoryExtractionConfig();

    this.db = db;
    this.preferredLanguage = agentPersonaWriter.language;
    this.agentConfig = agentPersonaWriter;
  }

  async composeWriting(payload: UserPersonaAgentPayload): Promise<UserPersonaAgentResult> {
    const aiInfraRepos = new AiInfraRepos(this.db, payload.userId, {});
    const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );

    const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: this.agentConfig.provider,
      label: 'persona writer',
      modelId: this.agentConfig.model,
    });

    const normalizedProvider = providerId.toLowerCase();
    const { apiKey: vaultApiKey, baseURL: vaultBaseURL } = extractCredentialsFromVault(
      runtimeState.runtimeConfig?.[normalizedProvider]?.keyVaults,
    );

    const useVaultCredential = !!vaultApiKey;
    const apiKey = useVaultCredential ? vaultApiKey : this.agentConfig.apiKey;
    const baseURL = useVaultCredential
      ? vaultBaseURL || this.agentConfig.baseURL
      : this.agentConfig.baseURL;

    const runtime = await ModelRuntime.initializeWithProvider(normalizedProvider, {
      apiKey,
      baseURL,
    });

    const personaModel = new UserPersonaModel(this.db, payload.userId);
    const lastDocument = await personaModel.getLatestPersonaDocument();
    const existingPersonaBaseline = payload.existingPersona ?? lastDocument?.persona;

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
