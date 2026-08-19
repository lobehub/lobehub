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
  if (error instanceof Error && error.message) return error.message;
  return t('workingPanel.localFile.publish.failed', { ns: 'chat' });
};

export const publishPreparedWorkspaceHtml = async ({
  agentId,
  plan,
  publish,
  topicId,
}: {
  agentId?: string | null;
  plan: ReadyWorkspaceHtmlPublishPlan;
  publish: WorkspaceHtmlArtifactPublisher['publish'];
  topicId: string;
}): Promise<WorkspaceHtmlArtifactPublishResult | undefined> => {
  try {
    const result = await publish({
      agentId: agentId ?? undefined,
      entryPath: plan.gathered.entryPath,
      files: plan.gathered.files,
      identifier: plan.gathered.identifier,
      packed: { html: plan.packed.html, sidecars: plan.packed.sidecars },
      title: plan.gathered.title,
      topicId,
    });

    toast.success(t('workingPanel.localFile.publish.success', { ns: 'chat' }));
    return result;
  } catch (error) {
    toast.error(workspaceHtmlPublishErrorMessage(error));
    return;
  }
};
