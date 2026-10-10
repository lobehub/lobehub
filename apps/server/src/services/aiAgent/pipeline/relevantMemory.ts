import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type { UserMemoryData } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type { SpendOrigin } from '@lobechat/types';
import debug from 'debug';

import { normalizeUserMemorySearchQueries, UserMemoryModel } from '@/database/models/userMemory';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { embedUserMemoryTexts } from '@/server/services/memory/userMemory/embedding';

const log = debug('lobe-server:relevant-memory');

/**
 * Per-layer retrieval budget for run injection.
 *
 * Deliberately NOT `MEMORY_SEARCH_TOP_K_LIMITS.medium`: that profile is tuned for
 * the `searchMemory` TOOL, where a model can refine and re-query, and it leaves
 * `contexts` at 0. A run gets exactly one shot at injection, so every live layer
 * the context engine can render gets a slot — identities stay short because they
 * are the least query-specific layer. Experience memory is retired and
 * `searchMemory` never returns it, so it gets no budget.
 */
const INJECTION_TOP_K = {
  activities: 0,
  contexts: 3,
  experiences: 0,
  identities: 2,
  preferences: 3,
} as const;

export interface FetchRelevantMemoryParams {
  db: LobeChatDatabase;
  /** The run's user turn, used verbatim as the retrieval query. */
  prompt: string;
  /**
   * Billing attribution for the query embedding. Set only for a share-visitor
   * run, whose embedding is otherwise billed to the creator as ordinary memory
   * usage — the same stamp the `searchMemory` tool puts on its own embeddings.
   */
  spendOrigin?: SpendOrigin;
  userId: string;
  workspaceId?: string;
}

/**
 * Retrieve the top-k user memories relevant to a run's prompt, shaped as the
 * {@link UserMemoryData} the context engine's `UserMemoryInjector` renders.
 *
 * The server run path historically injected only the persona document (a
 * narrative summary) and left `contexts` / `experiences` / `preferences` /
 * `identities` empty, so a run knew who the user *is* but nothing specific they
 * had told the agent before. This adds the retrieval half by reusing the same
 * two primitives the `searchMemory` tool already runs — `embedUserMemoryTexts`
 * for the query vector and `UserMemoryModel.searchMemory` for the BM25 + vector
 * ranking — so server runs and tool-time search cannot rank differently.
 *
 * Cost per run: one embedding request (a single query) plus one hybrid search
 * SQL. Callers gate it behind `ENABLE_RELEVANT_MEMORY_INJECTION`; the memory
 * feature flag itself is not changed here.
 *
 * Every failure degrades to `undefined` — memory injection is an enhancement,
 * never a reason to fail a run.
 */
export const fetchRelevantMemory = async ({
  db,
  prompt,
  spendOrigin,
  userId,
  workspaceId,
}: FetchRelevantMemoryParams): Promise<UserMemoryData | undefined> => {
  const queries = normalizeUserMemorySearchQueries([prompt]);
  if (queries.length === 0) return undefined;

  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;

  const runtime = await initModelRuntimeFromDB(
    db,
    userId,
    ENABLE_BUSINESS_FEATURES ? BRANDING_PROVIDER : provider,
    workspaceId,
  );

  const queryEmbeddings = (
    await embedUserMemoryTexts({
      input: queries,
      model: embeddingModel,
      runtime,
      source: 'aiAgent:relevantMemory',
      spendOrigin,
      userId,
    })
  ).filter((embedding): embedding is number[] => Boolean(embedding));

  // Same lexical candidate source the `searchMemory` tool uses, so injection and
  // tool-time search rank identically.
  const ftsSearchRepo = await createFtsSearchRepo({ db, userId, usage: 'memory' });
  const memoryModel = new UserMemoryModel(db, userId, ftsSearchRepo);
  const result = await memoryModel.searchMemory(
    { queries, topK: { ...INJECTION_TOP_K } },
    queryEmbeddings,
  );

  const memories: UserMemoryData = {
    contexts: result.contexts.map((context) => ({
      description: context.description,
      id: context.id,
      title: context.title,
    })),
    // Retired layer: `searchMemory` never searches it, so there is nothing to map.
    experiences: [],
    identities: (result.identities ?? []).map((identity) => ({
      capturedAt: identity.episodicDate ?? identity.capturedAt ?? identity.createdAt,
      description: identity.description,
      id: identity.id,
      role: identity.role,
      type: identity.type,
    })),
    preferences: result.preferences.map((preference) => ({
      conclusionDirectives: preference.conclusionDirectives,
      id: preference.id,
    })),
  };

  const retrievedCount =
    memories.contexts!.length + memories.identities!.length + memories.preferences!.length;
  if (retrievedCount === 0) {
    log('no relevant memories for this run');
    return undefined;
  }

  log(
    'injected %d relevant memories (contexts=%d preferences=%d identities=%d)',
    retrievedCount,
    memories.contexts!.length,
    memories.preferences!.length,
    memories.identities!.length,
  );

  return memories;
};
