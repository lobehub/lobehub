import { useCallback } from 'react';

import { publishWorkspaceHtmlArtifact } from '@/features/Portal/LocalFile/publishWorkspaceHtmlArtifact';
import { lambdaClient } from '@/libs/trpc/client';
import { messageService } from '@/services/message';

export interface WorkspaceHtmlArtifactFile {
  content: string;
  contentType: string;
  encoding: 'base64' | 'utf8';
  path: string;
}

export interface WorkspaceHtmlArtifactPublishInput {
  agentId?: string;
  entryPath: string;
  files: WorkspaceHtmlArtifactFile[];
  identifier: string;
  title: string;
  topicId: string;
}

export interface WorkspaceHtmlArtifactExisting {
  identifier: string;
  publicUrl?: string;
  revision?: number;
  status?: string;
}

export interface WorkspaceHtmlArtifactPublishResult {
  publicUrl?: string;
  revision?: number;
}

export interface WorkspaceHtmlArtifactPublisher {
  available: boolean;
  getExisting: (input: {
    identifier: string;
    topicId: string;
  }) => Promise<WorkspaceHtmlArtifactExisting | null>;
  publish: (
    input: WorkspaceHtmlArtifactPublishInput,
  ) => Promise<WorkspaceHtmlArtifactPublishResult>;
}

interface MarketDeploymentRecord {
  artifactIdentifier?: string;
  latestRevisionNumber?: number;
  publicUrl?: string;
  status?: string;
}

interface MarketDeploymentsApi {
  listByTopic: {
    query: (input: { topicId: string }) => Promise<{ data: MarketDeploymentRecord[] }>;
  };
  publishArtifact: {
    mutate: (input: {
      artifactIdentifier: string;
      messageId: string;
      requestedSlug?: string;
      topicId: string;
    }) => Promise<{ data: MarketDeploymentRecord }>;
  };
  publishWorkspaceHtml: {
    mutate: (input: {
      artifactIdentifier: string;
      files: WorkspaceHtmlArtifactFile[];
      html: string;
      requestedSlug?: string;
      title?: string;
      topicId: string;
    }) => Promise<{ data: MarketDeploymentRecord }>;
  };
}

const getMarketDeploymentsApi = (): MarketDeploymentsApi =>
  (lambdaClient as unknown as { market: { deployments: MarketDeploymentsApi } }).market.deployments;

export function useWorkspaceHtmlArtifactPublish(): WorkspaceHtmlArtifactPublisher {
  const getExisting = useCallback(async ({ identifier, topicId }) => {
    try {
      const result = await getMarketDeploymentsApi().listByTopic.query({ topicId });
      const match = result.data.find((item) => item.artifactIdentifier === identifier);
      if (!match) return null;

      return {
        identifier,
        publicUrl: match.publicUrl,
        revision: match.latestRevisionNumber,
        status: match.status,
      };
    } catch {
      return null;
    }
  }, []);

  const publish = useCallback(
    async (input: WorkspaceHtmlArtifactPublishInput) =>
      publishWorkspaceHtmlArtifact(input, {
        createMessage: messageService.createMessage,
        publishArtifact: async (params) => {
          const result = await getMarketDeploymentsApi().publishArtifact.mutate(params);
          return {
            latestRevisionNumber: result.data.latestRevisionNumber,
            publicUrl: result.data.publicUrl,
          };
        },
        publishSite: async (params) => {
          const result = await getMarketDeploymentsApi().publishWorkspaceHtml.mutate({
            artifactIdentifier: params.artifactIdentifier,
            files: params.files,
            html: params.html,
            requestedSlug: params.requestedSlug,
            title: params.requestedSlug,
            topicId: params.topicId,
          });

          return {
            latestRevisionNumber: result.data.latestRevisionNumber,
            publicUrl: result.data.publicUrl,
          };
        },
      }),
    [],
  );

  return { available: true, getExisting, publish };
}
