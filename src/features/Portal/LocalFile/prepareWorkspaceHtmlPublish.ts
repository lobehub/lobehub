import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import type { WorkspaceHtmlArtifactExisting } from '@/business/client/features/WorkspaceHtmlArtifactPublish';

import {
  type GatheredWorkspaceHtmlArtifact,
  gatherWorkspaceHtmlArtifact,
} from './gatherWorkspaceHtmlArtifact';
import {
  type PackedWorkspaceHtmlSite,
  packWorkspaceHtmlDocument,
} from './packWorkspaceHtmlDocument';
import { readWorkspaceAsset } from './readWorkspaceAsset';

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
  | {
      gathered: GatheredWorkspaceHtmlArtifact;
      hasExisting: boolean;
      packed: PackedWorkspaceHtmlSite;
    };

interface PrepareWorkspaceHtmlPublishInput {
  content?: string;
  deviceId?: string;
  filePath: string;
  getExisting?: (input: {
    identifier: string;
    topicId: string;
  }) => Promise<WorkspaceHtmlArtifactExisting | null>;
  hasExisting?: boolean;
  sandboxTopicId?: string;
  topicId: string;
  workingDirectory: string;
}

export const prepareWorkspaceHtmlPublish = async ({
  content,
  deviceId,
  filePath,
  getExisting,
  hasExisting,
  sandboxTopicId,
  topicId,
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

  if (hasExisting !== undefined) {
    return { gathered, hasExisting, packed };
  }

  if (!getExisting) {
    return { gathered, hasExisting: false, packed };
  }

  const existing = await getExisting({
    identifier: gathered.identifier,
    topicId,
  });

  return { gathered, hasExisting: !!existing, packed };
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
