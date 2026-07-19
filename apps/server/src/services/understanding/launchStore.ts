import type { ThreadMetadata } from '@lobechat/types';
import {
  OnboardingUnderstandingLaunchSchema,
  OnboardingUnderstandingThreadMarkerSchema,
  ThreadType,
} from '@lobechat/types';

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
