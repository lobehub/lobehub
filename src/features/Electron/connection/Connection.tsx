import { Center, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { useCallback, useState } from 'react';

import LoginStep from '@/app/[variants]/(desktop)/desktop-onboarding/features/LoginStep';
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
  const [isOpen, setIsOpen] = useState(false);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      <RemoteStatus
        onClick={() => {
          setIsOpen(true);
        }}
      />
      <Drawer
        classNames={{ header: styles.modal }}
        onClose={handleClose}
        open={isOpen}
        placement={'top'}
        size={'100vh'}
        style={{
          background: cssVar.colorBgLayout,
        }}
        styles={{ body: { padding: 0 }, header: { padding: 0 } }}
      >
        <Center style={{ height: '100%', overflow: 'auto', padding: 24 }}>
          <Flexbox style={{ maxWidth: 560, width: '100%' }}>
            <LoginStep onBack={handleClose} onNext={handleClose} />
          </Flexbox>
        </Center>
      </Drawer>
    </>
  );
};

export default Connection;
