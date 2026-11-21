'use client';

import { ActionIcon, Drawer, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MenuIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import { MARKETPLACE_PATH } from '@/features/Marketplace/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useNav } from '../../../../(main)/community/features/useNav';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const scrollToTop = () => {
  const scrollableElement = document?.querySelector(`#${SCROLL_CONTAINER_ID}`);

  if (!scrollableElement) return;
  scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
};

const styles = stylex.create({
  title: {
    fontSize: '18px',
    fontWeight: 700,
    lineHeight: 1.2,
  },
});

const Nav = memo(() => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const { items, activeKey, activeItem } = useNav();
  const navigate = useWorkspaceAwareNavigate();

  return (
    <>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.title).className} gap={4}>
        <ActionIcon
          aria-label={t('navPanel.openMenu')}
          color={cssVar.colorText}
          icon={MenuIcon}
          size={{ blockSize: 32, size: 18 }}
          onClick={() => {
            setOpen(true);
          }}
        />
        {activeItem?.label}
      </Flexbox>

      <Drawer
        noHeader
        closable={false}
        open={open}
        placement={'left'}
        width={260}
        zIndex={10}
        style={{
          background: cssVar.colorBgLayout,
          borderRight: `1px solid ${cssVar.colorSplit}`,
          paddingTop: 44,
        }}
        styles={{
          bodyContent: { gap: 20, justifyContent: 'space-between', padding: 16 },
        }}
        onClose={() => setOpen(false)}
      >
        <Menu
          compact
          selectable
          activeKey={activeKey}
          items={items}
          onClick={({ key }) => {
            scrollToTop();
            navigate(`${MARKETPLACE_PATH}/${key}`);
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
});

export default Nav;
