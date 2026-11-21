import {
  type CollectionDiagnostics,
  type OnboardingUnderstandingMessageMetadata,
  type OnboardingUnderstandingSession,
  type UnderstandingAnalysis,
} from '@lobechat/types';
import { vi } from 'vitest';

import type { StoredUnderstandingProviderContext } from '../sourceStore';
import type { UnderstandingProvider } from '../types';
import { UnderstandingService, type UnderstandingServiceDependencies } from '.';

export const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [
      {
        description: 'TEST_INTEREST_DESCRIPTION',
        rank: 96,
        title: 'TEST_INTEREST_TITLE',
      },
    ],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'TEST_PERSONA_CONTENT',
    reasoning: 'TEST_PERSONA_REASONING',
    tagline: 'TEST_PERSONA_TAGLINE',
  },
  profile: {
    description: 'TEST_PROFILE_DESCRIPTION',
    domains: ['TEST_PROFILE_DOMAIN'],
    name: 'TEST_PROFILE_NAME',
    pronoun: 'TEST_PROFILE_PRONOUN',
    roles: ['TEST_PROFILE_ROLE'],
    summary: 'TEST_PROFILE_SUMMARY',
    tagline: 'TEST_PROFILE_TAGLINE',
  },
};

export const diagnostics: CollectionDiagnostics = {
  errors: [],
  evidenceCount: 3,
  failedCount: 0,
  succeededCount: 2,
};

export const providerState = (
  status: 'pending' | 'running' | 'completed' | 'failed',
  revision = status === 'pending' ? 0 : 1,
) => ({
  errors: [],
  failedCount: 0,
  revision,
  status,
  succeededCount: status === 'completed' ? 2 : 0,
});

export const createSession = (
  sources: OnboardingUnderstandingSession['sources'] = {
    github: providerState('pending'),
    gmail: providerState('pending'),
  },
): OnboardingUnderstandingSession => ({ id: 'session-1', sources });

export const storedContext = (
  providerId: string,
  context: string,
  revision = 1,
): StoredUnderstandingProviderContext => ({
  context,
  diagnostics,
  providerId,
  revision,
  sourceCount: 3,
});

export const createHarness = (initialSession?: OnboardingUnderstandingSession) => {
  let session = initialSession;
  let latestAssistant:
    | { content?: unknown; error?: unknown; id: string; role: string; threadId?: string | null }
    | undefined;
  const stored = new Map<string, StoredUnderstandingProviderContext>();
  const assistantMetadata = new Map<string, OnboardingUnderstandingMessageMetadata>();
  const providers = new Map<string, UnderstandingProvider>();
  const githubCollect = vi.fn(async () => ({
    context: 'Provider: github\n\n# Source Brief\n\nPRIVATE_GITHUB_CONTEXT',
    diagnostics,
    sourceCount: 3,
  }));
  providers.set('github', {
    collect: githubCollect,
    connectionSource: 'lobehub',
    id: 'github',
  });
  providers.set('gmail', {
    collect: vi.fn(async () => ({
      context:
        'Provider: gmail\n\n# Source Brief\n\n```xml\n<gmail>PRIVATE_GMAIL_CONTEXT</gmail>\n```',
      diagnostics,
      sourceCount: 3,
    })),
    connectionSource: 'composio',
    id: 'gmail',
  });

  const repository = {
    commitDetailedWriting: vi.fn(async (_input: unknown) => ({ published: true })),
    commitWriting: vi.fn(async (_input: unknown) => ({ published: true })),
    completeProvider: vi.fn(
      async ({ providerId, revision }: { providerId: string; revision: number }) => {
        const transition = {
          ...session!,
          sources: {
            ...session!.sources,
            [providerId]: providerState('completed', revision),
          },
        };
        session = transition;
        return transition;
      },
    ),
    confirm: vi.fn(async () => ({ personaVersion: 1 })),
    expireProviderContexts: vi.fn(async () => session!),
    extend: vi.fn(
      async ({ feedback, providerIds }: { feedback?: string; providerIds: string[] }) => {
        const currentFeedback = session?.feedback ?? { revision: 0, turns: [] };
        const nextRevision = feedback ? currentFeedback.revision + 1 : currentFeedback.revision;
        session = {
          ...session!,
          feedback: {
            revision: nextRevision,
            turns: feedback
              ? [
                  ...currentFeedback.turns,
                  {
                    content: feedback,
                    createdAt: '2026-07-24T00:00:00.000Z',
                    revision: nextRevision,
                  },
                ]
              : currentFeedback.turns,
          },
          sources: {
            ...session!.sources,
            ...Object.fromEntries(
              providerIds
                .filter((providerId) => !session!.sources[providerId])
                .map((providerId) => [providerId, providerState('pending')]),
            ),
          },
        };
        return {
          attempts: providerIds
            .filter((providerId) => session!.sources[providerId]?.status === 'pending')
            .map((id) => ({ id, revision: 1 })),
          session,
        };
      },
    ),
    failProvider: vi.fn(async () => session!),
    failDetailedWriting: vi.fn(async () => session!),
    failWriting: vi.fn(
      async ({ error, feedbackRevision, generationRevision, sourceFingerprint }) => {
        session = {
          ...session!,
          writing: {
            error,
            feedbackRevision,
            generationRevision,
            resultMessageId: session?.writing?.resultMessageId,
            sourceFingerprint,
            status: 'failed',
            updatedAt: '2026-07-20T00:00:00.000Z',
          },
        };
        return session;
      },
    ),
    get: vi.fn(async () => session),
    initialize: vi.fn(async (_topicId: string, sessionId: string, providerIds: string[]) => {
      session = {
        id: sessionId,
        sources: Object.fromEntries(providerIds.map((id) => [id, providerState('pending')])),
      } as OnboardingUnderstandingSession;
      return session;
    }),
    markProviderRunning: vi.fn(async (_topicId: string, _sessionId: string, providerId: string) => {
      const revision = (session?.sources[providerId]?.revision ?? 0) + 1;
      session = {
        ...session!,
        sources: { ...session!.sources, [providerId]: providerState('running', revision) },
      };
      return { revision };
    }),
    prepareWriting: vi.fn(async ({ sourceFingerprint, threadId }) => {
      const feedbackRevision = session?.feedback?.revision ?? 0;
      const generationRevision = (session?.generationRevision ?? 0) + 1;
      session = {
        ...session!,
        generationRevision,
        writing: {
          feedbackRevision,
          generationRevision,
          resultMessageId: session?.writing?.resultMessageId,
          sourceFingerprint,
          status: 'running',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      };
      return { feedbackRevision, generationRevision, ready: true, threadId };
    }),
  };
  const sourceStore = {
    deleteSession: vi.fn(),
    get: vi.fn(
      async ({ providerId, revision }: { providerId: string; revision: number }) =>
        stored.get(`${providerId}:${revision}`) ?? null,
    ),
    put: vi.fn(async (value: StoredUnderstandingProviderContext) => {
      stored.set(`${value.providerId}:${value.revision}`, value);
    }),
  };
  const sourceStoreFactory = vi.fn(function () {
    return sourceStore;
  });
  const writerAgent = vi.fn(async () => ({
    id: 'agent-1',
    model: 'gpt-5.4-mini',
    provider: 'lobehub',
  }));
  const generateObject = vi.fn(
    async (
      _input: Parameters<UnderstandingServiceDependencies['generator']['generateObject']>[0],
      _options: Parameters<UnderstandingServiceDependencies['generator']['generateObject']>[1],
    ): Promise<unknown> => analysis,
  );
  type CreateMessageInput = Parameters<UnderstandingServiceDependencies['messages']['create']>[0];
  const messages = {
    create: vi.fn(async (_input: CreateMessageInput) => ({ id: 'assistant-structured' })),
    findById: vi.fn(async (id: string) => ({
      content: JSON.stringify(analysis),
      metadata: assistantMetadata.has(id)
        ? { onboardingUnderstanding: assistantMetadata.get(id) }
        : undefined,
    })),
    findLatestAssistantMessageByThread: vi.fn(async () => latestAssistant),
  };
  const listAvailableProviderIds = vi.fn(async (providerIds: readonly string[]) => [
    ...providerIds,
  ]);
  const dependencies: UnderstandingServiceDependencies = {
    connectorData: {
      listAvailableProviderIds,
    } as unknown as UnderstandingServiceDependencies['connectorData'],
    generator: {
      generateObject:
        generateObject as UnderstandingServiceDependencies['generator']['generateObject'],
    },
    ids: () => 'session-new',
    messages,
    persona: { getLatestPersonaDocument: vi.fn(async () => null) },
    providers,
    repository,
    sourceStore: sourceStoreFactory,
    topic: {
      assertActiveOnboardingTopic: vi.fn(),
    },
    userId: 'user-1',
    writerAgent,
  };

  return {
    dependencies,
    githubCollect,
    generateObject,
    listAvailableProviderIds,
    messages,
    repository,
    service: new UnderstandingService(dependencies),
    setLatestAssistant: (value: typeof latestAssistant) => (latestAssistant = value),
    setAssistantMetadata: (id: string, value: OnboardingUnderstandingMessageMetadata) =>
      assistantMetadata.set(id, value),
    setProvider: (providerId: string, provider: UnderstandingProvider) =>
      providers.set(providerId, provider),
    setSession: (value: OnboardingUnderstandingSession) => (session = value),
    sourceStore,
    sourceStoreFactory,
    stored,
    writerAgent,
  };
};
