import { Center, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Suspense, useCallback } from 'react';

import LoginStep from '@/app/[variants]/(desktop)/desktop-onboarding/features/LoginStep';
import { BrandTextLoading } from '@/components/Loading';
import { useElectronStore } from '@/store/electron';
import { isMacOS } from '@/utils/platform';

import RemoteStatus from './RemoteStatus';

const isMac = isMacOS();

const styles = createStaticStyles(({ css }) => {
  return {
    modal: css`
      .ant-drawer-close {
        position: absolute;
        inset-block-start: ${isMac ? '12px' : '46px'};
        inset-inline-end: 6px;
      }
    `,
  };
});

const Connection = () => {
  const [isOpen, setConnectionDrawerOpen] = useElectronStore((s) => [
    s.isConnectionDrawerOpen,
    s.setConnectionDrawerOpen,
  ]);

  const handleClose = useCallback(() => {
    setConnectionDrawerOpen(false);
  }, [setConnectionDrawerOpen]);

  return (
    <>
      <RemoteStatus
        onClick={() => {
          setConnectionDrawerOpen(true);
        }}
      />
      <Drawer
        classNames={{ header: styles.modal }}
        open={isOpen}
        placement={'top'}
        size={'100vh'}
        styles={{ body: { padding: 0 }, header: { padding: 0 } }}
        style={{
          background: cssVar.colorBgLayout,
        }}
        onClose={handleClose}
      >
        <Suspense
          fallback={
            <Center style={{ height: '100%' }}>
              <BrandTextLoading debugId="Connection" />
            </Center>
          }
        >
          <Center style={{ height: '100%', overflow: 'auto', padding: 24 }}>
            <Flexbox style={{ maxWidth: 560, width: '100%' }}>
              <LoginStep onBack={handleClose} onNext={handleClose} />
            </Flexbox>
          </Center>
        </Suspense>
      </Drawer>
    </>
  );
};

export default Connection;
