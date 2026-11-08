import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import PortalHeader from '../components/Header';
import Title from './Title';
import { getTaskDetailPageUrl } from './url';
import { useForeignTaskDetail } from './useForeignTaskDetail';

const TaskDetailHeader = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('verify');
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  const foreignWorkspace = useChatStore(chatPortalSelectors.taskDetailWorkspace);
  const activeDetail = useTaskStore((state) =>
    taskId && !foreignWorkspace
      ? state.taskDetailMap[state.taskRefIndex?.[taskId] ?? taskId]
      : undefined,
  );
  const { data: foreignDetail } = useForeignTaskDetail();
  const detail = foreignWorkspace ? foreignDetail : activeDetail;
  const pageUrl = getTaskDetailPageUrl({
    agentId: detail?.agentId ?? undefined,
    appOrigin,
    identifier: detail?.identifier,
    title: detail?.name,
    // A task from another workspace links to its own workspace's page.
    workspaceSlug: foreignWorkspace ? foreignWorkspace.slug : activeWorkspaceSlug,
  });

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        <ActionIcon
          disabled={!pageUrl}
          icon={ExternalLink}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('report.actions.openInBrowser')}
          onClick={() => {
            if (!pageUrl) return;
            openTrustedExternalUrl(pageUrl);
          }}
        />
      }
      onClose={onClose}
    />
  );
});

export default TaskDetailHeader;
