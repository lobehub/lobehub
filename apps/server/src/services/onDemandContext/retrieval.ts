import {
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
  MEMORY_SEARCH_TOP_K_LIMITS,
} from '@lobechat/const';
import { hashContent, selectRelevantPersonaFragments } from '@lobechat/context-engine/onDemand';
import type {
  OnDemandContextCandidate,
  OnDemandRetrievalAuthority,
  OnDemandRetrievalBatch,
  OnDemandRetrievalMode,
  SearchMemoryParams,
  SearchMemoryResult,
} from '@lobechat/types';

import { UserMemoryModel } from '@/database/models/userMemory';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import type { LobeChatDatabase } from '@/database/type';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { retrieveExpertiseCandidates } from '@/server/services/expertise/retrieval';
import { embedUserMemoryTexts } from '@/server/services/memory/userMemory/embedding';

type MemoryEffort = 'high' | 'low' | 'medium';

export interface OnDemandServerRetrievalDeps {
  embedQuery: (query: string) => Promise<number[] | undefined>;
  getExpertise: () => Promise<readonly OnDemandContextCandidate[]>;
  getPersona: () => Promise<{ persona?: string | null; tagline?: string | null } | undefined>;
  searchMemory: (
    params: SearchMemoryParams,
    embeddings?: number[][],
  ) => Promise<SearchMemoryResult>;
}

const normalizeEffort = (value?: MemoryEffort): MemoryEffort =>
  value === 'low' || value === 'high' ? value : 'medium';

const clampRelevance = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const normalizeType = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';

const preferenceAuthority = (item: Record<string, unknown>): OnDemandRetrievalAuthority => {
  const metadata =
    item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : {};
  const kind = normalizeType(metadata.constraintKind ?? metadata.kind ?? item.type);

  return metadata.explicit === true ||
    ['constraint', 'explicit', 'instruction', 'rule'].includes(kind)
    ? 'explicit_constraint'
    : 'stable_preference';
};

const conflictKey = (item: Record<string, unknown>): string | undefined => {
  const metadata =
    item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : {};
  const value = metadata.conflictKey ?? metadata.constraintKey;

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const memoryCandidate = (input: {
  authority: OnDemandRetrievalAuthority;
  content: string;
  id: string;
  item: Record<string, unknown>;
  relevance: number;
  sourceType: 'memory' | 'user';
  userId: string;
}): OnDemandContextCandidate | undefined => {
  const content = input.content.trim();
  if (!content) return undefined;

  return Object.freeze({
    approval: { state: 'approved' as const },
    authority: input.authority,
    ...(conflictKey(input.item) && { conflictKey: conflictKey(input.item) }),
    content,
    contentHash: hashContent(content),
    id: input.id,
    relevance: input.relevance,
    scope: {
      ownerUserId: input.userId,
      share: 'personal' as const,
      shareGate: 'allowed' as const,
    },
    source: { id: input.id, type: input.sourceType },
    ...(input.item.updatedAt instanceof Date && {
      sourceVersion: input.item.updatedAt.toISOString(),
    }),
  });
};

const mapMemoryCandidates = (
  result: SearchMemoryResult,
  userId: string,
): OnDemandContextCandidate[] => {
  const ranking = result.meta?.ranking;
  const candidates: OnDemandContextCandidate[] = [];
  const push = (value: OnDemandContextCandidate | undefined) => {
    if (value) candidates.push(value);
  };

  for (const preference of result.preferences ?? []) {
    const item = preference as unknown as Record<string, unknown>;
    push(
      memoryCandidate({
        authority: preferenceAuthority(item),
        content: preference.conclusionDirectives ?? '',
        id: preference.id,
        item,
        relevance: clampRelevance(ranking?.preferences?.[preference.id]?.final),
        sourceType: 'memory',
        userId,
      }),
    );
  }

  for (const experience of result.experiences ?? []) {
    const item = experience as unknown as Record<string, unknown>;
    push(
      memoryCandidate({
        authority: 'memory',
        content: [experience.situation, experience.keyLearning].filter(Boolean).join('\n'),
        id: experience.id,
        item,
        relevance: clampRelevance(ranking?.experiences?.[experience.id]?.final),
        sourceType: 'memory',
        userId,
      }),
    );
  }

  for (const context of result.contexts ?? []) {
    const item = context as unknown as Record<string, unknown>;
    push(
      memoryCandidate({
        authority: 'memory',
        content: [context.title, context.description].filter(Boolean).join('\n'),
        id: context.id,
        item,
        relevance: clampRelevance(ranking?.contexts?.[context.id]?.final),
        sourceType: 'memory',
        userId,
      }),
    );
  }

  for (const identity of result.identities ?? []) {
    const item = identity as unknown as Record<string, unknown>;
    push(
      memoryCandidate({
        authority: 'stable_preference',
        content: [identity.role, identity.description].filter(Boolean).join('\n'),
        id: identity.id,
        item,
        relevance: clampRelevance(ranking?.identities?.[identity.id]?.final),
        sourceType: 'user',
        userId,
      }),
    );
  }

  for (const activity of result.activities ?? []) {
    const item = activity as unknown as Record<string, unknown>;
    push(
      memoryCandidate({
        authority: 'memory',
        content: [activity.narrative, activity.notes].filter(Boolean).join('\n'),
        id: activity.id,
        item,
        relevance: clampRelevance(ranking?.activities?.[activity.id]?.final),
        sourceType: 'memory',
        userId,
      }),
    );
  }

  return candidates;
};

const mapPersonaCandidates = (params: {
  currentUserMessage: string;
  persona?: { persona?: string | null; tagline?: string | null };
  userId: string;
}): OnDemandContextCandidate[] => {
  const persona = [params.persona?.tagline, params.persona?.persona].filter(Boolean).join('\n');
  return selectRelevantPersonaFragments(persona, params.currentUserMessage).map((fragment, index) =>
    Object.freeze({
      approval: { state: 'approved' as const },
      authority: 'stable_preference' as const,
      content: fragment,
      contentHash: hashContent(fragment),
      id: `persona-${index}`,
      scope: {
        ownerUserId: params.userId,
        share: 'personal' as const,
        shareGate: 'allowed' as const,
      },
      source: { id: 'persona', type: 'user' as const },
    }),
  );
};

const searchParams = (effort: MemoryEffort, query: string): SearchMemoryParams => {
  const limits = MEMORY_SEARCH_TOP_K_LIMITS[effort];

  return {
    queries: [query],
    topK: {
      ...limits,
      identities: effort === 'high' ? 4 : effort === 'low' ? 1 : 2,
    },
  };
};

export const runOnDemandServerRetrieval = async (params: {
  currentUserMessage: string;
  deps: OnDemandServerRetrievalDeps;
  effort?: MemoryEffort;
  memoryEnabled: boolean;
  userId: string;
}): Promise<OnDemandRetrievalBatch> => {
  const startedAt = performance.now();
  const candidates: OnDemandContextCandidate[] = [];
  let mode: OnDemandRetrievalMode = 'none';

  if (params.memoryEnabled && params.currentUserMessage.trim()) {
    const query = params.currentUserMessage;
    const request = searchParams(normalizeEffort(params.effort), query);
    let embedding: number[] | undefined;

    try {
      embedding = await params.deps.embedQuery(query);
    } catch {
      embedding = undefined;
    }

    if (Array.isArray(embedding) && embedding.length > 0) {
      try {
        const result = await params.deps.searchMemory(request, [embedding]);
        candidates.push(...mapMemoryCandidates(result, params.userId));
        mode = 'vector';
      } catch {
        mode = 'lexical_fallback';
      }
    } else {
      mode = 'lexical_fallback';
    }

    if (mode === 'lexical_fallback') {
      try {
        const result = await params.deps.searchMemory(request, []);
        candidates.push(...mapMemoryCandidates(result, params.userId));
      } catch {
        // Retrieval is additive. The current user turn and stable prefix remain usable.
      }
    }

    try {
      const persona = await params.deps.getPersona();
      candidates.push(
        ...mapPersonaCandidates({
          currentUserMessage: query,
          persona,
          userId: params.userId,
        }),
      );
    } catch {
      // Persona is optional and never blocks the current turn.
    }
  }

  try {
    candidates.push(...(await params.deps.getExpertise()));
    if (mode === 'none' && candidates.length > 0) mode = 'lexical_fallback';
  } catch {
    // Expertise retrieval is optional and never blocks the current turn.
  }

  return Object.freeze({
    candidates: Object.freeze(candidates),
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    mode,
  });
};

export const retrieveOnDemandServerContext = async (params: {
  agentId?: string;
  currentUserMessage: string;
  db: LobeChatDatabase;
  effort?: MemoryEffort;
  memoryEnabled: boolean;
  userId: string;
  workspaceId?: string;
}): Promise<OnDemandRetrievalBatch> => {
  const memoryModel = new UserMemoryModel(params.db, params.userId);
  const personaModel = new UserPersonaModel(params.db, params.userId);
  const embeddingConfig =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;

  return runOnDemandServerRetrieval({
    currentUserMessage: params.currentUserMessage,
    deps: {
      embedQuery: async (query) => {
        const runtime = await initModelRuntimeFromDB(
          params.db,
          params.userId,
          embeddingConfig.provider,
          params.workspaceId,
        );
        const [embedding] = await embedUserMemoryTexts({
          input: [query],
          model: embeddingConfig.model,
          runtime,
          source: 'agentRuntime:onDemand.memoryRetrieval',
          userId: params.userId,
        });
        return embedding;
      },
      getExpertise: () =>
        retrieveExpertiseCandidates({
          agentId: params.agentId,
          db: params.db,
          userId: params.userId,
          workspaceId: params.workspaceId,
        }),
      getPersona: async () => {
        const persona = await personaModel.getLatestPersonaDocument();
        return persona ? { persona: persona.persona, tagline: persona.tagline } : undefined;
      },
      searchMemory: (query, embeddings) =>
        memoryModel.searchMemory(query, embeddings) as Promise<SearchMemoryResult>,
    },
    effort: params.effort,
    memoryEnabled: params.memoryEnabled,
    userId: params.userId,
  });
};
