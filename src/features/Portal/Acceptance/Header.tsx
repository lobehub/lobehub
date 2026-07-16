import { DESKTOP_HEADER_ICON_SMALL_SIZE, isDesktop } from '@lobechat/const';
import { ActionIcon, copyToClipboard, Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { electronSystemService } from '@/services/electron/system';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import Header from '../components/Header';
import Title from './Title';

const AcceptanceHeader = memo(() => {
  const { message } = App.useApp();
  const { t } = useTranslation('verify');
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const pagePath = acceptanceId
    ? buildWorkspaceAwarePath(`/acceptance/${acceptanceId}`, activeWorkspaceSlug)
    : undefined;
  const pageUrl = pagePath ? `${appOrigin}${pagePath}` : undefined;
  // Without an origin the URL is relative — the system browser has nothing to resolve it against.
  const externalUrl = appOrigin && pageUrl ? pageUrl : undefined;

  return (
    <Header
      title={<Title />}
      rightExtra={
        <Flexbox horizontal gap={4}>
          <ActionIcon
            disabled={!pageUrl}
            icon={Copy}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.copyLink')}
            onClick={async () => {
              if (!pageUrl) return;
              await copyToClipboard(pageUrl);
              message.success(t('report.actions.copyLinkSuccess'));
            }}
          />
          <ActionIcon
            disabled={!externalUrl}
            icon={ExternalLink}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.openInBrowser')}
            onClick={() => {
              if (!externalUrl) return;
              // In Electron a `window.open` is denied by the window-open handler,
              // so hand the URL to the system browser through the main process.
              if (isDesktop) {
                void electronSystemService.openExternalLink(externalUrl);
                return;
              }
              window.open(externalUrl, '_blank', 'noopener,noreferrer');
            }}
          />
        </Flexbox>
      }
    />
  );
});

export default AcceptanceHeader;
