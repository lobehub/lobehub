import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
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

const TaskDetailHeader = memo(() => {
  const { t } = useTranslation('verify');
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  const agentId = useTaskStore((state) =>
    taskId ? (state.taskDetailMap[taskId]?.agentId ?? undefined) : undefined,
  );
  const taskTitle = useTaskStore((state) =>
    taskId ? (state.taskDetailMap[taskId]?.name ?? undefined) : undefined,
  );
  const pageUrl = getTaskDetailPageUrl({
    agentId,
    appOrigin,
    taskId,
    title: taskTitle,
    workspaceSlug: activeWorkspaceSlug,
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
    />
  );
});

export default TaskDetailHeader;
