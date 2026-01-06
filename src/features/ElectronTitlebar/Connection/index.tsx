import { Drawer } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';

import ConnectionMode from './ConnectionMode';
import RemoteStatus from './RemoteStatus';
import WaitingOAuth from './Waiting';

const styles = createStaticStyles(({ css }) => {
  return {
    modal: css`
      .ant-drawer-close {
        position: absolute;
        inset-block-start: 8px;
        inset-inline-end: 0;
      }
    `,
  };
});

const Connection = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isWaiting, setWaiting] = useState(false);

  return (
    <>
      <RemoteStatus
        onClick={() => {
          setIsOpen(true);
        }}
      />
      <Drawer
        classNames={{ header: styles.modal }}
        height={'100vh'}
        onClose={() => {
          setIsOpen(false);
        }}
        open={isOpen}
        placement={'top'}
        style={{
          background: cssVar.colorBgLayout,
        }}
        styles={{ body: { padding: 0 }, header: { padding: 0 } }}
      >
        {isWaiting ? (
          <WaitingOAuth setIsOpen={setIsOpen} setWaiting={setWaiting} />
        ) : (
          <ConnectionMode setWaiting={setWaiting} />
        )}
      </Drawer>
    </>
  );
};

export default Connection;
