import type { LobeChatDatabase } from '@lobechat/database';
import { agentOperations, messages } from '@lobechat/database/schemas';
import type { ThreadMetadata } from '@lobechat/types';
import {
  OnboardingUnderstandingLaunchSchema,
  OnboardingUnderstandingThreadMarkerSchema,
  RequestTrigger,
  ThreadType,
} from '@lobechat/types';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';

export interface UnderstandingLaunchReference {
  assistantMessageId: string;
  operationId: string;
}

interface UnderstandingLaunchIdentity {
  agentId: string;
  kind: 'merged' | 'source';
  threadId: string;
  topicId: string;
}

interface UnderstandingLaunchStoreDependencies {
  durable: {
    find: (
      identity: UnderstandingLaunchIdentity,
    ) => Promise<UnderstandingLaunchReference | undefined>;
  };
  threads: {
    findById: (threadId: string) => Promise<
      | {
          agentId?: string | null;
          metadata?: ThreadMetadata | null;
          topicId: string;
          type: string;
        }
      | undefined
    >;
    update: (threadId: string, value: { metadata: ThreadMetadata }) => Promise<unknown>;
  };
  topics: {
    findById: (topicId: string) => Promise<
      | {
          metadata?: {
            runningOperation?: {
              assistantMessageId: string;
              operationId: string;
              threadId?: string | null;
            } | null;
          } | null;
        }
      | undefined
    >;
  };
}

export class UnderstandingLaunchStore {
  constructor(private readonly dependencies: UnderstandingLaunchStoreDependencies) {}

  find = async (
    identity: UnderstandingLaunchIdentity,
  ): Promise<UnderstandingLaunchReference | undefined> => {
    const { marker } = await this.readThread(identity);
    if (marker.launch) return marker.launch;

    const durable = await this.dependencies.durable.find(identity);
    if (durable) {
      const launch = OnboardingUnderstandingLaunchSchema.parse(durable);
      await this.save(identity, launch);
      return launch;
    }

    const topic = await this.dependencies.topics.findById(identity.topicId);
    if (!topic) throw new Error('Understanding launch topic is unavailable');
    const running = topic.metadata?.runningOperation;
    if (!running || running.threadId !== identity.threadId) return;
    const launch = OnboardingUnderstandingLaunchSchema.parse({
      assistantMessageId: running.assistantMessageId,
      operationId: running.operationId,
    });
    await this.save(identity, launch);
    return launch;
  };

  save = async (
    identity: UnderstandingLaunchIdentity,
    launch: UnderstandingLaunchReference,
  ): Promise<void> => {
    const { marker, metadata } = await this.readThread(identity);
    const parsed = OnboardingUnderstandingThreadMarkerSchema.parse({ ...marker, launch });
    if (marker.launch) {
      if (
        marker.launch.assistantMessageId !== parsed.launch?.assistantMessageId ||
        marker.launch.operationId !== parsed.launch?.operationId
      ) {
        throw new Error('Understanding thread already references a different agent launch');
      }
      return;
    }
    await this.dependencies.threads.update(identity.threadId, {
      metadata: { ...metadata, onboardingUnderstanding: parsed },
    });
  };

  private readThread = async (identity: UnderstandingLaunchIdentity) => {
    const thread = await this.dependencies.threads.findById(identity.threadId);
    const marker = OnboardingUnderstandingThreadMarkerSchema.safeParse(
      thread?.metadata?.onboardingUnderstanding,
    );
    if (
      !thread ||
      thread.topicId !== identity.topicId ||
      thread.agentId !== identity.agentId ||
      thread.type !== ThreadType.Isolation ||
      !marker.success ||
      marker.data.kind !== identity.kind
    ) {
      throw new Error('Understanding launch thread is unavailable');
    }
    return { marker: marker.data, metadata: thread.metadata ?? {} };
  };
}

const findDurableLaunch = async (
  db: LobeChatDatabase,
  userId: string,
  identity: UnderstandingLaunchIdentity,
): Promise<UnderstandingLaunchReference | undefined> => {
  const [operation] = await db
    .select({
      createdAt: agentOperations.createdAt,
      operationId: agentOperations.id,
    })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.userId, userId),
        isNull(agentOperations.workspaceId),
        eq(agentOperations.agentId, identity.agentId),
        eq(agentOperations.topicId, identity.topicId),
        eq(agentOperations.threadId, identity.threadId),
        eq(agentOperations.trigger, RequestTrigger.Onboarding),
      ),
    )
    .orderBy(desc(agentOperations.createdAt))
    .limit(1);
  if (!operation) return;

  // Both timestamps use the database clock, and execAgent inserts the assistant placeholder before
  // AgentRuntime records the operation. This avoids app/database clock skew from startedAt.
  const [assistant] = await db
    .select({ assistantMessageId: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        isNull(messages.workspaceId),
        eq(messages.agentId, identity.agentId),
        eq(messages.topicId, identity.topicId),
        eq(messages.threadId, identity.threadId),
        eq(messages.role, 'assistant'),
        lte(messages.createdAt, operation.createdAt),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!assistant) return;

  return { assistantMessageId: assistant.assistantMessageId, operationId: operation.operationId };
};

export const createUnderstandingLaunchStore = (db: LobeChatDatabase, userId: string) => {
  const threads = new ThreadModel(db, userId);
  return new UnderstandingLaunchStore({
    durable: { find: (identity) => findDurableLaunch(db, userId, identity) },
    threads: {
      findById: async (threadId) => {
        const thread = await threads.findById(threadId);
        if (!thread) return;
        return {
          agentId: thread.agentId,
          metadata: thread.metadata,
          topicId: thread.topicId,
          type: thread.type,
        };
      },
      update: (threadId, value) => threads.update(threadId, value),
    },
    topics: new TopicModel(db, userId),
  });
};
