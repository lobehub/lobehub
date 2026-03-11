'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Drawer } from 'antd';
import { cssVar } from 'antd-style';
import { XIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { NAV_PANEL_RIGHT_DRAWER_ID } from './';
import SkeletonList from './components/SkeletonList';
import SideBarHeaderLayout from './SideBarHeaderLayout';

interface SideBarDrawerProps {
  action?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  open: boolean;
  subHeader?: ReactNode;
  title?: ReactNode;
}

const SideBarDrawer = memo<SideBarDrawerProps>(
  ({ subHeader, open, onClose, children, title, action }) => {
    const size = 280;
    return (
      <Drawer
        destroyOnHidden
        closable={false}
        getContainer={() => document.querySelector(`#${NAV_PANEL_RIGHT_DRAWER_ID}`)!}
        mask={false}
        open={open}
        placement="left"
        size={size}
        rootStyle={{
          bottom: 0,
          overflow: 'hidden',
          position: 'absolute',
          top: 0,
          width: `${size}px`,
        }}
        styles={{
          body: {
            background: cssVar.colorBgLayout,
            padding: 0,
          },
          header: {
            background: cssVar.colorBgLayout,
            borderBottom: 'none',
            padding: 0,
          },
          wrapper: {
            borderLeft: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRight: `1px solid ${cssVar.colorBorderSecondary}`,
            boxShadow: `4px 0 8px -2px rgba(0,0,0,.04)`,
            zIndex: 0,
          },
        }}
        title={
          <>
            <SideBarHeaderLayout
              showBack={false}
              showTogglePanelButton={false}
              left={
                typeof title === 'string' ? (
                  <Text
                    ellipsis
                    fontSize={14}
                    style={{ fontWeight: 600, paddingLeft: 8 }}
                    weight={400}
                  >
                    {title}
                  </Text>
                ) : (
                  title
                )
              }
              right={
                <>
                  {action}
                  <ActionIcon icon={XIcon} size={DESKTOP_HEADER_ICON_SIZE} onClick={onClose} />
                </>
              }
            />
            {subHeader}
          </>
        }
        onClose={onClose}
      >
        <Suspense
          fallback={
            <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
              <SkeletonList rows={3} />
            </Flexbox>
          }
        >
          {children}
        </Suspense>
      </Drawer>
    );
  },
);

export default SideBarDrawer;
