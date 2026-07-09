import { DOWNLOAD_URL } from '@lobechat/const';
import type { DropdownMenuProps } from '@lobehub/ui';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ChevronRight, Download, Monitor, Smartphone } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronStylish } from '@/styles/electron';

interface GetAppButtonProps {
  onSelect?: () => void;
  placement?: DropdownMenuProps['placement'];
}

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const GetAppButton = memo<GetAppButtonProps>(({ onSelect, placement }) => {
  const { t } = useTranslation('common');

  const items = useMemo<DropdownMenuProps['items']>(
    () => [
      {
        icon: <Icon icon={Smartphone} />,
        key: 'mobile-app',
        label: t('mobileApp'),
        onClick: () => {
          openExternal(DOWNLOAD_URL.mobile);
          onSelect?.();
        },
      },
      {
        icon: <Icon icon={Monitor} />,
        key: 'desktop-app',
        label: t('desktopApp'),
        onClick: () => {
          openExternal(DOWNLOAD_URL.default);
          onSelect?.();
        },
      },
    ],
    [onSelect, t],
  );

  return (
    <DropdownMenu
      items={items}
      placement={placement}
      trigger="hover"
      popupProps={{
        className: electronStylish.nodrag,
        style: {
          minWidth: 180,
          transition: 'none',
        },
      }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={12}
        style={{
          borderRadius: 8,
          boxSizing: 'content-box',
          cursor: 'pointer',
          height: 28,
          marginInline: 4,
          paddingBlock: 6,
          paddingInline: 12,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = cssVar.colorFillTertiary as string;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <Icon icon={Download} size={'small'} style={{ color: cssVar.colorTextSecondary }} />
        <Flexbox flex={1}>{t('getApp')}</Flexbox>
        <Icon icon={ChevronRight} size={'small'} style={{ color: cssVar.colorTextSecondary }} />
      </Flexbox>
    </DropdownMenu>
  );
});

export default GetAppButton;
