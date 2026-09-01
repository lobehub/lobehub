import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import {
  type GatheredWorkspaceHtmlArtifact,
  gatherWorkspaceHtmlArtifact,
} from './gatherWorkspaceHtmlArtifact';
import {
  type PackedWorkspaceHtmlSite,
  packWorkspaceHtmlDocument,
} from './packWorkspaceHtmlDocument';
import { readWorkspaceAsset } from './readWorkspaceAsset';
import type {
  WorkspaceHtmlArtifactPublisher,
  WorkspaceHtmlArtifactPublishResult,
} from './workspaceHtmlArtifact';

export interface ReadyWorkspaceHtmlPublishPlan {
  gathered: GatheredWorkspaceHtmlArtifact;
  packed: PackedWorkspaceHtmlSite;
}

const base64ByteLength = (content: string): number => {
  const compact = content.replaceAll(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
};

export const getWorkspaceHtmlPublishSizeBytes = (plan: ReadyWorkspaceHtmlPublishPlan): number =>
  new TextEncoder().encode(plan.packed.html).byteLength +
  plan.packed.sidecars.reduce(
    (total, file) =>
      total +
      (file.encoding === 'base64'
        ? base64ByteLength(file.content)
        : new TextEncoder().encode(file.content).byteLength),
    0,
  );

export type WorkspaceHtmlPublishPlan =
  | {
      blocked: 'too-large' | 'too-many';
      totalBytes: number;
    }
  | {
      blocked: 'unreadable';
    }
  | {
      blocked: 'unresolved';
      unresolvedHrefs: string[];
    }
  | ReadyWorkspaceHtmlPublishPlan;

interface PrepareWorkspaceHtmlPublishInput {
  content?: string;
  deviceId?: string;
  filePath: string;
  sandboxTopicId?: string;
  workingDirectory: string;
}

export const prepareWorkspaceHtmlPublish = async ({
  content,
  deviceId,
  filePath,
  sandboxTopicId,
  workingDirectory,
}: PrepareWorkspaceHtmlPublishInput): Promise<WorkspaceHtmlPublishPlan> => {
  let htmlContent = content;
  if (htmlContent === undefined) {
    const asset = await readWorkspaceAsset({
      deviceId,
      path: filePath,
      sandboxTopicId,
      workingDirectory,
    });
    if (!asset.ok || !asset.text) return { blocked: 'unreadable' };
    htmlContent = asset.text;
  }

  const gathered = await gatherWorkspaceHtmlArtifact({
    htmlContent,
    htmlFilePath: filePath,
    readAsset: (absolutePath) =>
      readWorkspaceAsset({
        deviceId,
        path: absolutePath,
        sandboxTopicId,
        workingDirectory,
      }),
    workingDirectory,
  });

  if (gathered.blocked) {
    return { blocked: gathered.blocked, totalBytes: gathered.totalBytes };
  }

  const packed = packWorkspaceHtmlDocument({
    entryPath: gathered.entryPath,
    files: gathered.files,
  });

  if (packed.unresolvedHrefs.length > 0) {
    return { blocked: 'unresolved', unresolvedHrefs: packed.unresolvedHrefs };
  }

  return { gathered, packed };
};

export const notifyWorkspaceHtmlPublishBlocked = (
  plan: Extract<WorkspaceHtmlPublishPlan, { blocked: string }>,
) => {
  if (plan.blocked === 'unreadable') {
    toast.error(t('workingPanel.localFile.publish.failed', { ns: 'chat' }));
    return;
  }

  if (plan.blocked === 'unresolved') {
    toast.error(t('workingPanel.localFile.publish.unresolvedLocals', { ns: 'chat' }));
    return;
  }

  toast.error(
    t(
      plan.blocked === 'too-many'
        ? 'workingPanel.localFile.publish.tooMany'
        : 'workingPanel.localFile.publish.tooLarge',
      { ns: 'chat', size: plan.totalBytes },
    ),
  );
};

const workspaceHtmlPublishErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message === 'unresolved-local-assets') {
    return t('workingPanel.localFile.publish.unresolvedLocals', { ns: 'chat' });
  }
  return t('workingPanel.localFile.publish.failed', { ns: 'chat' });
};

export const publishPreparedWorkspaceHtml = async ({
  agentId,
  onError,
  onUploadPhase,
  onUploadProgress,
  plan,
  publish,
  signal,
  topicId,
}: {
  agentId?: string | null;
  onError?: (error: unknown) => boolean;
  onUploadPhase?: Parameters<WorkspaceHtmlArtifactPublisher['publish']>[0]['onUploadPhase'];
  onUploadProgress?: Parameters<WorkspaceHtmlArtifactPublisher['publish']>[0]['onUploadProgress'];
  plan: ReadyWorkspaceHtmlPublishPlan;
  publish: WorkspaceHtmlArtifactPublisher['publish'];
  signal?: AbortSignal;
  topicId: string;
}): Promise<WorkspaceHtmlArtifactPublishResult | undefined> => {
  try {
    const result = await publish({
      agentId: agentId ?? undefined,
      entryPath: plan.gathered.entryPath,
      files: plan.gathered.files,
      identifier: plan.gathered.identifier,
      onUploadPhase,
      onUploadProgress,
      packed: { html: plan.packed.html, sidecars: plan.packed.sidecars },
      signal,
      title: plan.gathered.title,
      topicId,
    });

    toast.success(t('workingPanel.localFile.publish.success', { ns: 'chat' }));
    return result;
  } catch (error) {
    if (!onError?.(error)) toast.error(workspaceHtmlPublishErrorMessage(error));
    return;
  }
};
