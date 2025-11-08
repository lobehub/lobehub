'use client';

import { Icon } from '@lobehub/ui';
import { FileText, Globe, ImageIcon, LayoutGrid, Mic2, SquarePlay } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Menu from '@/components/Menu';
import type { MenuProps } from '@/components/Menu';
import { FilesTabs } from '@/types/files';

import { useFileCategory } from '../../../hooks/useFileCategory';

const FileMenu = memo(() => {
  const { t } = useTranslation('file');
  const [activeKey, setActiveKey] = useFileCategory();

  const items: MenuProps['items'] = useMemo(
    () =>
      [
        {
          icon: <Icon icon={LayoutGrid} />,
          key: FilesTabs.All,
          label: t('tab.all'),
        },
        {
          icon: <Icon icon={FileText} />,
          key: FilesTabs.Documents,
          label: t('tab.documents'),
        },
        {
          icon: <Icon icon={ImageIcon} />,
          key: FilesTabs.Images,
          label: t('tab.images'),
        },
        {
          icon: <Icon icon={Mic2} />,
          key: FilesTabs.Audios,
          label: t('tab.audios'),
        },
        {
          icon: <Icon icon={SquarePlay} />,
          key: FilesTabs.Videos,
          label: t('tab.videos'),
        },
        {
          icon: <Icon icon={Globe} />,
          key: FilesTabs.Websites,
          label: t('tab.websites'),
        },
      ]
        .filter(Boolean)
        .slice(0, 5) as MenuProps['items'],
    [t],
  );

  return (
    <Flexbox>
      <Menu
        compact
        items={items}
        onClick={({ key }) => {
          setActiveKey(key);
        }}
        selectable
        selectedKeys={[activeKey]}
      />
    </Flexbox>
  );
});

FileMenu.displayName = 'FileMenu';

export default FileMenu;
