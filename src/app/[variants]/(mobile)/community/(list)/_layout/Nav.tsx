'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { MenuIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Menu from '@/components/Menu';
import { DiscoverTab } from '@/types/discover';

import { useNav } from '../../../../(main)/community/features/useNav';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const scrollToTop = () => {
  const scrollableElement = document?.querySelector(`#${SCROLL_CONTAINER_ID}`);

  if (!scrollableElement) return;
  scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
};

export const styles = createStaticStyles(({ css, cssVar }) => ({
  activeNavItem: css`
    background: ${cssVar.colorFillTertiary};
  `,
  container: css`
    height: auto;
    padding-block: 4px;
    background: ${cssVar.colorBgLayout};
  `,
  navItem: css`
    font-weight: 500;
  `,
  title: css`
    font-size: 18px;
    font-weight: 700;
    line-height: 1.2;
  `,
}));

const Nav = memo(() => {
  const [open, setOpen] = useState(false);
  const { items, activeKey, activeItem } = useNav();
  const navigate = useNavigate();

  return (
    <>
      <Flexbox align={'center'} className={styles.title} gap={4} horizontal>
        <ActionIcon
          color={cssVar.colorText}
          icon={MenuIcon}
          onClick={() => {
            setOpen(true);
          }}
          size={{ blockSize: 32, size: 18 }}
        />
        {activeItem?.label}
      </Flexbox>

      <Drawer
        bodyStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          justifyContent: 'space-between',
          padding: 16,
        }}
        headerStyle={{ display: 'none' }}
        onClick={() => setOpen(false)}
        onClose={() => setOpen(false)}
        open={open}
        placement={'left'}
        rootStyle={{ position: 'absolute' }}
        style={{
          background: cssVar.colorBgLayout,
          borderRight: `1px solid ${cssVar.colorSplit}`,
          paddingTop: 44,
        }}
        width={260}
        zIndex={10}
      >
        <Menu
          compact
          items={items}
          onClick={({ key }) => {
            scrollToTop();
            if (key === DiscoverTab.Home) {
              navigate('/community');
            } else {
              navigate(`/community/${key}`);
            }
          }}
          selectable
          selectedKeys={[activeKey]}
        />
      </Drawer>
    </>
  );
});

export default Nav;
