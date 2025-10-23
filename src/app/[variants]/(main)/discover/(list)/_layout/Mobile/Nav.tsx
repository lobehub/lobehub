'use client';

import { ActionIcon } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStyles } from 'antd-style';
import { MenuIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useNavigate } from 'react-router-dom';

import Menu from '@/components/Menu';
import { withSuspense } from '@/components/withSuspense';
import { DiscoverTab } from '@/types/discover';

import { useNav } from '../../../features/useNav';

export const useStyles = createStyles(({ css, token }) => ({
  activeNavItem: css`
    background: ${token.colorFillTertiary};
  `,
  container: css`
    height: auto;
    padding-block: 4px;
    background: ${token.colorBgLayout};
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
  const { styles, theme } = useStyles();
  const { items, activeKey, activeItem } = useNav();
  const navigate = useNavigate();

  return (
    <>
      <Flexbox align={'center'} className={styles.title} gap={4} horizontal>
        <ActionIcon
          color={theme.colorText}
          icon={MenuIcon}
          onClick={() => setOpen(true)}
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
          background: theme.colorBgLayout,
          borderRight: `1px solid ${theme.colorSplit}`,
          paddingTop: 44,
        }}
        width={260}
        zIndex={10}
      >
        <Menu
          compact
          items={items}
          onClick={({ key }) => {
            if (key === DiscoverTab.Home) {
              navigate('/');
            } else {
              navigate(`/${key}`);
            }
          }}
          selectable
          selectedKeys={[activeKey]}
        />
      </Drawer>
    </>
  );
});

export default withSuspense(Nav);
