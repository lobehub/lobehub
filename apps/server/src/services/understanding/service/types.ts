import type { OnboardingUnderstandingRepository } from '@lobechat/database';

import type { AiGenerationService } from '@/server/services/aiGeneration';
import type { ConnectorDataService } from '@/server/services/connectorData';

import type { UnderstandingSourceStore } from '../sourceStore';
import type { UnderstandingProvider } from '../types';

export interface ProviderOperationInput {
  providerId: string;
  revision: number;
  sessionId: string;
  topicId: string;
}

export interface ProcessCollectedInput {
  expectedSourceFingerprint: string;
  responseLanguage: string;
  sessionId: string;
  topicId: string;
}

export type UnderstandingRepository = Pick<
  OnboardingUnderstandingRepository,
  | 'commitWriting'
  | 'commitDetailedWriting'
  | 'completeProvider'
  | 'confirm'
  | 'expireProviderContexts'
  | 'extend'
  | 'failProvider'
  | 'failWriting'
  | 'failDetailedWriting'
  | 'get'
  | 'initialize'
  | 'markProviderRunning'
  | 'prepareWriting'
>;

export type UnderstandingContexts = Pick<UnderstandingSourceStore, 'get' | 'put'>;

export interface UnderstandingServiceDependencies {
  connectorData: ConnectorDataService;
  generator: Pick<AiGenerationService, 'generateObject'>;
  ids: () => string;
  messages: {
    create: (params: {
      agentId: string;
      content: string;
      model: string;
      provider: string;
      role: 'assistant';
      threadId: string;
      topicId: string;
    }) => Promise<{ id: string }>;
    findById: (id: string) => Promise<{ content?: unknown; metadata?: unknown } | null | undefined>;
    findLatestAssistantMessageByThread: (input: {
      agentId: string;
      threadId: string;
      topicId: string;
    }) => Promise<
      | { content?: unknown; error?: unknown; id: string; role: string; threadId?: string | null }
      | null
      | undefined
    >;
  };
  persona: {
    getLatestPersonaDocument: () => Promise<
      { persona?: string | null; tagline?: string | null } | null | undefined
    >;
  };
  providers: ReadonlyMap<string, UnderstandingProvider>;
  repository: UnderstandingRepository;
  sourceStore: () => UnderstandingContexts;
  topic: {
    assertActiveOnboardingTopic: (topicId: string) => Promise<void>;
  };
  userId: string;
  writerAgent: () => Promise<{ id: string; model: string; provider: string }>;
}
