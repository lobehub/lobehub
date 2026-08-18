import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceHtmlArtifactPublish } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { isHtmlFile } from '@/components/HtmlPreview';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import {
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
  publishPreparedWorkspaceHtml,
} from './prepareWorkspaceHtmlPublish';
import { openWorkspaceHtmlPublishConfirm } from './PublishHtmlArtifactConfirm';

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
    (path: string, isFolder: boolean) => enabled && available && !isFolder && isHtmlFile({ path }),
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
          workingDirectory,
        });

        loadingToast.close();

        if ('blocked' in plan) {
          notifyWorkspaceHtmlPublishBlocked(plan);
          return;
        }

        const existing = await getExisting({ identifier: plan.gathered.identifier, topicId });

        openWorkspaceHtmlPublishConfirm({
          hasExisting: !!existing,
          plan,
          onOk: () => {
            void publishPreparedWorkspaceHtml({ agentId, plan, publish, topicId }).then(
              (result) => {
                if (result) openLocalFile({ deviceId, filePath, workingDirectory });
              },
            );
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
