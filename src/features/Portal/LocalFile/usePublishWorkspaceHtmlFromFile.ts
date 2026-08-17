import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceHtmlArtifactPublish } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import {
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
} from './prepareWorkspaceHtmlPublish';
import { openWorkspaceHtmlPublishConfirm } from './PublishHtmlArtifactConfirm';
import { shouldOfferWorkspaceHtmlPublish } from './publishHtmlArtifactUi';

interface UsePublishWorkspaceHtmlFromFileInput {
  deviceId?: string;
  workingDirectory: string;
}

export const usePublishWorkspaceHtmlFromFile = ({
  deviceId,
  workingDirectory,
}: UsePublishWorkspaceHtmlFromFileInput) => {
  const { t } = useTranslation('chat');
  const enabled = useUserStore(labPreferSelectors.enableArtifactDeployment);
  const { available, getExisting, publish } = useWorkspaceHtmlArtifactPublish();
  const agentId = useChatStore((s) => s.activeAgentId);
  const topicId = useChatStore((s) => s.activeTopicId);
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const canOfferFile = useCallback(
    (path: string, isFolder: boolean) =>
      shouldOfferWorkspaceHtmlPublish({
        available,
        enabled,
        isFolder,
        path,
      }),
    [available, enabled],
  );

  const publishFile = useCallback(
    async (filePath: string) => {
      if (!topicId) {
        toast.error(t('workingPanel.localFile.publish.noTopic'));
        return;
      }

      const loadingToast = toast.loading(t('workingPanel.localFile.publish.scanning'));
      try {
        const plan = await prepareWorkspaceHtmlPublish({
          deviceId,
          filePath,
          getExisting,
          topicId,
          workingDirectory,
        });

        loadingToast.close();

        if ('blocked' in plan) {
          notifyWorkspaceHtmlPublishBlocked(plan);
          return;
        }

        openWorkspaceHtmlPublishConfirm({
          plan,
          onOk: () => {
            void (async () => {
              try {
                await publish({
                  agentId: agentId ?? undefined,
                  entryPath: plan.gathered.entryPath,
                  files: plan.gathered.files,
                  identifier: plan.gathered.identifier,
                  title: plan.gathered.title,
                  topicId,
                });
                toast.success(t('workingPanel.localFile.publish.success'));
                openLocalFile({ deviceId, filePath, workingDirectory });
              } catch (error) {
                toast.error(
                  error instanceof Error && error.message === 'unresolved-local-assets'
                    ? t('workingPanel.localFile.publish.unresolvedLocals')
                    : error instanceof Error && error.message
                      ? error.message
                      : t('workingPanel.localFile.publish.failed'),
                );
              }
            })();
          },
        });
      } catch {
        loadingToast.close();
        toast.error(t('workingPanel.localFile.publish.failed'));
      }
    },
    [agentId, deviceId, getExisting, openLocalFile, publish, t, topicId, workingDirectory],
  );

  return { canOfferFile, publishFile };
};
