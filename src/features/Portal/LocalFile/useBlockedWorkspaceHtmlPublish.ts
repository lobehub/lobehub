import type {
  GatheredWorkspaceHtmlResource,
  WorkspaceHtmlArtifactPublisher,
  WorkspaceHtmlArtifactPublishResult,
} from '@lobechat/html-artifact';
import { isPathInsideWorkspace } from '@lobechat/html-artifact';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import debug from 'debug';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { copyWorkspaceHtmlArtifactIntoWorkspace } from './copyWorkspaceHtmlArtifactIntoWorkspace';
import {
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
  publishPreparedWorkspaceHtml,
  type ReadyWorkspaceHtmlPublishPlan,
  type WorkspaceHtmlPublishPlan,
} from './prepareWorkspaceHtmlPublish';
import { openWorkspaceHtmlPublishConfirm } from './PublishHtmlArtifactConfirm';

type OutsideWorkspacePlan = Extract<WorkspaceHtmlPublishPlan, { blocked: 'outside-workspace' }>;
type ResourceSource = 'nested' | 'workspace';
export type DisplayedWorkspaceHtmlResource = GatheredWorkspaceHtmlResource & {
  source?: ResourceSource;
};

const log = debug('lobe-client:workspace-html-publish');

export interface BlockedWorkspaceHtmlPublishInput {
  agentId?: string | null;
  close: () => void;
  copyFile: (from: string, to: string) => Promise<void>;
  deviceId?: string;
  filePath: string;
  hasExisting: boolean;
  onError?: (error: unknown) => boolean;
  onPublished?: (
    result: WorkspaceHtmlArtifactPublishResult,
    plan: ReadyWorkspaceHtmlPublishPlan,
  ) => void;
  plan: OutsideWorkspacePlan;
  publish: WorkspaceHtmlArtifactPublisher['publish'];
  runPublish?: (input: { plan: ReadyWorkspaceHtmlPublishPlan; successMessage?: string }) => void;
  sandboxTopicId?: string;
  topicId: string;
  workingDirectory: string;
  writeFile: (path: string, content: string) => Promise<void>;
}

export const useBlockedWorkspaceHtmlPublish = ({
  agentId,
  close,
  copyFile,
  deviceId,
  filePath,
  hasExisting,
  onError,
  onPublished,
  plan,
  publish,
  runPublish,
  sandboxTopicId,
  topicId,
  workingDirectory,
  writeFile,
}: BlockedWorkspaceHtmlPublishInput) => {
  const { t } = useTranslation(['chat', 'common']);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<GatheredWorkspaceHtmlResource[]>([]);
  const [resources, setResources] = useState<DisplayedWorkspaceHtmlResource[]>(plan.escaped);
  const cancelled = useRef(false);
  const busyRef = useRef(false);
  const htmlEntry = plan.gathered.files.find((file) => file.path === plan.gathered.entryPath);
  const htmlContent = htmlEntry?.encoding === 'utf8' ? htmlEntry.content : undefined;

  useEffect(() => () => void (cancelled.current = true), []);

  const cancel = () => {
    cancelled.current = true;
    close();
  };

  const handleForceChange = (checked: boolean) => {
    if (!checked) {
      setForce(false);
      return;
    }

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('workingPanel.localFile.publish.outsideWorkspace.forceHint', { ns: 'chat' }),
      okButtonProps: { danger: true },
      okText: t('confirm', { ns: 'common' }),
      onOk: () => setForce(true),
      title: t('workingPanel.localFile.publish.outsideWorkspace.forceLabel', { ns: 'chat' }),
    });
  };

  const openConfirm = (ready: ReadyWorkspaceHtmlPublishPlan, copiedDirectory?: string) => {
    close();
    const successMessage = copiedDirectory
      ? t('workingPanel.localFile.publish.outsideWorkspace.copiedToast', { dir: copiedDirectory })
      : undefined;
    openWorkspaceHtmlPublishConfirm({
      hasExisting,
      plan: ready,
      onOk: () => {
        if (runPublish) {
          runPublish({ plan: ready, successMessage });
          return;
        }
        void publishPreparedWorkspaceHtml({
          agentId,
          onError,
          plan: ready,
          publish,
          successMessage,
          topicId,
        }).then((result) => {
          if (result) onPublished?.(result, ready);
        });
      },
    });
  };

  const stillBlocked = (paths: string[]) => {
    log('Prepared workspace copy still has unresolved paths: %O', paths);
    toast.error(t('workingPanel.localFile.publish.outsideWorkspace.stillBlocked', { ns: 'chat' }));
  };

  const prepareNext = async (
    input: Parameters<typeof prepareWorkspaceHtmlPublish>[0],
    requireClean = false,
  ) => {
    const next = await prepareWorkspaceHtmlPublish(input);
    if ('blocked' in next) {
      if (next.blocked === 'outside-workspace') {
        stillBlocked(next.escaped.map((item) => item.absolutePath));
      } else {
        notifyWorkspaceHtmlPublishBlocked(next);
      }
      return;
    }
    if (requireClean && next.gathered.missing.length > 0) {
      stillBlocked(next.gathered.missing);
      return;
    }
    return next;
  };

  const handleContinue = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    cancelled.current = false;
    setFailed([]);
    setBusy(true);

    try {
      if (force) {
        const ready = await prepareNext({
          allowExternalReads: true,
          content: htmlContent,
          deviceId,
          filePath,
          sandboxTopicId,
          workingDirectory,
        });
        if (!cancelled.current && ready) openConfirm(ready);
        return;
      }

      const closure = await prepareNext({
        allowExternalReads: true,
        content: htmlContent,
        deviceId,
        filePath,
        sandboxTopicId,
        workingDirectory,
      });
      if (cancelled.current || !closure) return;

      const displayedPaths = new Set(resources.map((resource) => resource.absolutePath));
      if (
        closure.gathered.resources.some((resource) => !displayedPaths.has(resource.absolutePath))
      ) {
        const initiallyDisplayed = new Set(plan.escaped.map((resource) => resource.absolutePath));
        setResources(
          closure.gathered.resources.map((resource) =>
            initiallyDisplayed.has(resource.absolutePath)
              ? resource
              : {
                  ...resource,
                  source: isPathInsideWorkspace(resource.absolutePath, workingDirectory)
                    ? 'workspace'
                    : 'nested',
                },
          ),
        );
        return;
      }

      const entry = closure.gathered.files.find(
        (file) => file.path === closure.gathered.entryPath && file.encoding === 'utf8',
      );
      if (!entry) {
        notifyWorkspaceHtmlPublishBlocked({ blocked: 'unreadable' });
        return;
      }

      const copied = await copyWorkspaceHtmlArtifactIntoWorkspace({
        copyFile,
        htmlContent: entry.content,
        htmlFilePath: filePath,
        resources: closure.gathered.resources,
        workingDirectory,
        writeFile,
      });
      if (cancelled.current) return;
      if (copied.failed.length > 0) {
        setFailed(copied.failed);
        return;
      }

      const ready = await prepareNext(
        {
          deviceId,
          filePath: copied.entryPath,
          sandboxTopicId,
          workingDirectory,
        },
        true,
      );
      if (!cancelled.current && ready) openConfirm(ready, copied.targetDirectory);
    } catch (error) {
      if (cancelled.current) return;
      log('Failed to copy workspace HTML entry %s: %O', filePath, error);
      toast.error(
        t('workingPanel.localFile.publish.outsideWorkspace.copyFailedEntry', { ns: 'chat' }),
      );
    } finally {
      busyRef.current = false;
      if (!cancelled.current) setBusy(false);
    }
  };

  return { busy, cancel, failed, force, handleContinue, handleForceChange, resources };
};
