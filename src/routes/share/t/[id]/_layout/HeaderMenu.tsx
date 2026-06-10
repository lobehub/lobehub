'use client';

import { ActionIcon, copyToClipboard } from '@lobehub/ui';
import { type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { ExternalLink, Flag, LinkIcon, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mailTo, OFFICIAL_SITE } from '@/const/url';

const REPORT_EMAIL = 'hi@lobehub.com';

const HeaderMenu = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();

  const handleCopyLink = useCallback(async () => {
    await copyToClipboard(window.location.href);
    message.success(t('shareModal.copyLinkSuccess'));
  }, [message, t]);

  const items = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <LinkIcon size={16} />,
        key: 'copy-link',
        label: t('sharePage.menu.copyLink'),
        onClick: handleCopyLink,
      },
      {
        icon: <ExternalLink size={16} />,
        key: 'go-to-lobehub',
        label: (
          <a href={OFFICIAL_SITE} rel="noopener noreferrer" target="_blank">
            {t('sharePage.menu.goToLobeHub')}
          </a>
        ),
      },
      {
        icon: <Flag size={16} />,
        key: 'report',
        label: <a href={mailTo(REPORT_EMAIL)}>{t('sharePage.menu.report')}</a>,
      },
    ],
    [t, handleCopyLink],
  );

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontal} title={t('sharePage.menu.more')} />
    </DropdownMenu>
  );
});

HeaderMenu.displayName = 'ShareTopicHeaderMenu';

export default HeaderMenu;
