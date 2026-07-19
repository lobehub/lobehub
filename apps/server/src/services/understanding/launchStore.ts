import type { LobeChatDatabase } from '@lobechat/database';
import { threads as threadTable } from '@lobechat/database/schemas';
import type { ThreadMetadata } from '@lobechat/types';
import {
  OnboardingUnderstandingLaunchSchema,
  OnboardingUnderstandingThreadMarkerSchema,
  ThreadType,
} from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

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
  threads: {
    claim: (
      identity: UnderstandingLaunchIdentity,
      launch: UnderstandingLaunchReference,
    ) => Promise<UnderstandingLaunchReference>;
    findById: (threadId: string) => Promise<
      | {
          agentId?: string | null;
          metadata?: ThreadMetadata | null;
          topicId: string;
          type: string;
        }
      | undefined
    >;
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

    const topic = await this.dependencies.topics.findById(identity.topicId);
    if (!topic) throw new Error('Understanding launch topic is unavailable');
    const running = topic.metadata?.runningOperation;
    if (!running || running.threadId !== identity.threadId) return;
    const launch = OnboardingUnderstandingLaunchSchema.parse({
      assistantMessageId: running.assistantMessageId,
      operationId: running.operationId,
    });
    return this.save(identity, launch);
  };

  save = async (
    identity: UnderstandingLaunchIdentity,
    launch: UnderstandingLaunchReference,
  ): Promise<UnderstandingLaunchReference> =>
    this.dependencies.threads.claim(identity, OnboardingUnderstandingLaunchSchema.parse(launch));

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

const claimThreadLaunch = async (
  db: LobeChatDatabase,
  userId: string,
  identity: UnderstandingLaunchIdentity,
  launch: UnderstandingLaunchReference,
): Promise<UnderstandingLaunchReference> =>
  db.transaction(async (tx) => {
    const [thread] = await tx
      .select({
        agentId: threadTable.agentId,
        metadata: threadTable.metadata,
        topicId: threadTable.topicId,
        type: threadTable.type,
      })
      .from(threadTable)
      .where(
        and(
          eq(threadTable.id, identity.threadId),
          eq(threadTable.userId, userId),
          isNull(threadTable.workspaceId),
        ),
      )
      .for('update');
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
    if (marker.data.launch) return marker.data.launch;

    const nextMarker = OnboardingUnderstandingThreadMarkerSchema.parse({
      ...marker.data,
      launch,
    });
    await tx
      .update(threadTable)
      .set({
        metadata: { ...thread.metadata, onboardingUnderstanding: nextMarker },
      })
      .where(
        and(
          eq(threadTable.id, identity.threadId),
          eq(threadTable.userId, userId),
          isNull(threadTable.workspaceId),
        ),
      );
    return launch;
  });

export const createUnderstandingLaunchStore = (db: LobeChatDatabase, userId: string) => {
  const threads = new ThreadModel(db, userId);
  return new UnderstandingLaunchStore({
    threads: {
      claim: (identity, launch) => claimThreadLaunch(db, userId, identity, launch),
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
    },
    topics: new TopicModel(db, userId),
  });
};
