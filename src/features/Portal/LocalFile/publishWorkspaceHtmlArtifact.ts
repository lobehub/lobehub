import { ARTIFACT_TAG } from '@lobechat/const';
import { escapeXmlAttr } from '@lobechat/prompts';

import { hostedPath, packWorkspaceHtmlDocument } from './packWorkspaceHtmlDocument';
import type {
  WorkspaceHtmlArtifactFile,
  WorkspaceHtmlArtifactPublishInput,
  WorkspaceHtmlArtifactPublishResult,
} from './workspaceHtmlArtifact';

export const wrapWorkspaceHtmlArtifact = ({
  html,
  identifier,
  title,
}: {
  html: string;
  identifier: string;
  title: string;
}): string =>
  `<${ARTIFACT_TAG} identifier="${escapeXmlAttr(identifier)}" type="text/html" title="${escapeXmlAttr(title)}">\n${html}\n</${ARTIFACT_TAG}>`;

export interface PublishWorkspaceHtmlSiteParams {
  artifactIdentifier: string;
  files: WorkspaceHtmlArtifactFile[];
  html: string;
  requestedSlug?: string;
  topicId: string;
}

export const publishWorkspaceHtmlArtifact = async (
  input: WorkspaceHtmlArtifactPublishInput,
  deps: {
    createMessage: (params: {
      agentId: string;
      content: string;
      role: 'assistant';
      topicId: string;
    }) => Promise<{ id: string }>;
    publishArtifact: (params: {
      artifactIdentifier: string;
      messageId: string;
      requestedSlug?: string;
      topicId: string;
    }) => Promise<{ latestRevisionNumber?: number; publicUrl?: string }>;
    publishSite?: (
      params: PublishWorkspaceHtmlSiteParams,
    ) => Promise<{ latestRevisionNumber?: number; publicUrl?: string }>;
  },
): Promise<WorkspaceHtmlArtifactPublishResult> => {
  if (!input.agentId) {
    throw new Error('unavailable');
  }

  const packed =
    input.packed ??
    (() => {
      const fresh = packWorkspaceHtmlDocument({
        entryPath: input.entryPath,
        files: input.files,
      });
      if (fresh.unresolvedHrefs.length > 0) {
        throw new Error('unresolved-local-assets');
      }
      return fresh;
    })();

  if (packed.sidecars.length > 0) {
    if (!deps.publishSite) {
      throw new Error('unavailable');
    }

    const deployment = await deps.publishSite({
      artifactIdentifier: input.identifier,
      files: packed.sidecars.map((file) => ({
        ...file,
        path: hostedPath(file.path),
      })),
      html: packed.html,
      requestedSlug: input.title,
      topicId: input.topicId,
    });

    return {
      publicUrl: deployment.publicUrl,
      revision: deployment.latestRevisionNumber,
    };
  }

  const message = await deps.createMessage({
    agentId: input.agentId,
    content: wrapWorkspaceHtmlArtifact({
      html: packed.html,
      identifier: input.identifier,
      title: input.title,
    }),
    role: 'assistant',
    topicId: input.topicId,
  });

  const deployment = await deps.publishArtifact({
    artifactIdentifier: input.identifier,
    messageId: message.id,
    requestedSlug: input.title,
    topicId: input.topicId,
  });

  return {
    publicUrl: deployment.publicUrl,
    revision: deployment.latestRevisionNumber,
  };
};
