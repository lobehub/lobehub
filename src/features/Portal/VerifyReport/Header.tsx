import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon, copyToClipboard, Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, ExternalLink, Maximize2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import Header from '../components/Header';
import Title from './Title';

const VerifyReportHeader = memo(() => {
  const { message } = App.useApp();
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const reportPath = runId
    ? buildWorkspaceAwarePath(`/verify/${runId}`, activeWorkspaceSlug)
    : undefined;
  const reportUrl = reportPath ? `${appOrigin}${reportPath}` : undefined;

  return (
    <Header
      title={<Title />}
      rightExtra={
        <Flexbox horizontal gap={4}>
          <ActionIcon
            disabled={!reportUrl}
            icon={Copy}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.copyLink')}
            onClick={async () => {
              if (!reportUrl) return;
              await copyToClipboard(reportUrl);
              message.success(t('report.actions.copyLinkSuccess'));
            }}
          />
          <ActionIcon
            disabled={!reportPath}
            icon={ExternalLink}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.openInNewWindow')}
            onClick={() => {
              if (!reportPath) return;
              window.open(reportPath, '_blank', 'noopener,noreferrer');
            }}
          />
          <ActionIcon
            disabled={!runId}
            icon={Maximize2}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.openFullPage')}
            onClick={() => {
              if (!runId) return;
              navigate(`/verify/${runId}`);
              clearPortalStack();
            }}
          />
        </Flexbox>
      }
    />
  );
});

export default VerifyReportHeader;
