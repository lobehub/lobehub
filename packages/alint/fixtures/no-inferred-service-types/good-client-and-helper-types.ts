// Fixture: typing a client object or a pure service-module helper is not payload inference.
import type { ProjectListResponse } from '@lobechat/types';

import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import { transcriptBucketOf } from '@/services/message/replica';

export type ScopedLambdaClient = ReturnType<typeof createWorkspaceLambdaClient>;

const buckets = new Map<string, ReturnType<typeof transcriptBucketOf>>();

export const bucketFor = (topicId: string) => {
  const cached = buckets.get(topicId);
  if (cached) return cached;
  const bucket = transcriptBucketOf(topicId);
  buckets.set(topicId, bucket);
  return bucket;
};

export const listProjects = async (
  client: ScopedLambdaClient,
): Promise<ProjectListResponse> => client.project.list.query({ limit: 100, offset: 0 });
