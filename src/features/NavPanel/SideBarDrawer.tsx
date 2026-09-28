'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, DrawerPopup, DrawerPortal, DrawerRoot, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, Suspense, useEffect, useState } from 'react';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import SkeletonList from './components/SkeletonList';
import { NAV_PANEL_RIGHT_DRAWER_ID } from './constants';
import { OverlayContainerContext } from './OverlayContainer';
import SideBarHeaderLayout from './SideBarHeaderLayout';

const DRAWER_WIDTH = 280;

// Stays under the base-ui floating tier (1100) so dropdowns and popovers raised
// from inside the panel still paint above it.
const DRAWER_Z_INDEX = 1000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow: hidden auto;
    flex: 1;
    min-height: 0;
    background: ${cssVar.colorBgLayout};
  `,
  panel: css`
    border-inline: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgLayout};
    box-shadow: 4px 0 8px -2px rgb(0 0 0 / 4%);
  `,
  popup: css`
    position: absolute;
    overflow: hidden;
  `,
}));

interface SideBarDrawerProps {
  action?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  open: boolean;
  subHeader?: ReactNode;
  title?: ReactNode;
  /** Content that needs more room (e.g. rows with inline actions) can widen past the default. */
  width?: number;
}

const SideBarDrawer = memo<SideBarDrawerProps>(
  ({ subHeader, open, onClose, children, title, action, width = DRAWER_WIDTH }) => {
    const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

    useEffect(() => {
      setPortalContainer(document.querySelector<HTMLElement>(`#${NAV_PANEL_RIGHT_DRAWER_ID}`));
    }, []);

    return (
      <OverlayContainerContext value={overlayContainer}>
        <DrawerRoot
          modal={false}
          open={open}
          zIndex={DRAWER_Z_INDEX}
          onOpenChange={(nextOpen, eventDetails) => {
            if (nextOpen || eventDetails.reason === 'outside-press') return;
            onClose();
          }}
        >
          <DrawerPortal container={portalContainer}>
            <DrawerPopup
              flush
              className={styles.popup}
              panelClassName={styles.panel}
              placement={'left'}
              ref={setOverlayContainer}
              width={width}
            >
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
                    <ActionIcon
                      icon={XIcon}
                      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                      style={{ marginInlineEnd: -2 }}
                      onClick={onClose}
                    />
                  </>
                }
              />
              {subHeader}
              <div className={styles.body}>
                <Suspense
                  fallback={
                    <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
                      <SkeletonList rows={3} />
                    </Flexbox>
                  }
                >
                  {children}
                </Suspense>
              </div>
            </DrawerPopup>
          </DrawerPortal>
        </DrawerRoot>
      </OverlayContainerContext>
    );
  },
);

export default SideBarDrawer;
