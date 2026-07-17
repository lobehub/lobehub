import { DESKTOP_HEADER_ICON_SMALL_SIZE, isDesktop } from '@lobechat/const';
import { ActionIcon, copyToClipboard, Flexbox, Icon } from '@lobehub/ui';
import { type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { Copy, ExternalLink, MoreHorizontal, RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
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

  // Secondary actions live behind the title's `…` — the header's right side
  // stays for the portal chrome (open external / close).
  const menuItems: DropdownItem[] = [
    {
      disabled: !pageUrl,
      icon: <Icon icon={Copy} />,
      key: 'copy-link',
      label: t('report.actions.copyLink'),
      onClick: async () => {
        if (!pageUrl) return;
        await copyToClipboard(pageUrl);
        message.success(t('report.actions.copyLinkSuccess'));
      },
    },
    {
      disabled: !acceptanceId,
      icon: <Icon icon={RefreshCw} />,
      key: 'refresh',
      label: t('acceptance.actions.refresh'),
      onClick: () => {
        if (!acceptanceId) return;
        void globalMutate(verifyKeys.acceptanceBundle(acceptanceId));
      },
    },
  ];

  return (
    <Header
      rightExtra={
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
      }
      title={
        <Flexbox horizontal align={'center'} gap={2} style={{ minWidth: 0 }}>
          <Title />
          <DropdownMenu
            iconSpaceMode={'group'}
            items={menuItems}
            placement={'bottomLeft'}
            popupProps={{ style: { minWidth: 140 } }}
          >
            <ActionIcon
              icon={MoreHorizontal}
              size={'small'}
              style={{ flex: 'none' }}
              title={t('acceptance.actions.more')}
            />
          </DropdownMenu>
        </Flexbox>
      }
    />
  );
});

export default AcceptanceHeader;
