'use client';

import { Flexbox, Modal } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PortalContent } from '@/features/Portal/router';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    background: linear-gradient(${cssVar.colorBgElevated}, ${cssVar.colorBgContainer}) !important;
  `,
}));

const Layout = () => {
  const [showMobilePortal, isPortalThread, clearPortalStack] = useChatStore((s) => [
    s.showPortal,
    portalThreadSelectors.showThread(s),
    s.clearPortalStack,
  ]);
  const { t } = useTranslation('portal');

  const renderBody = (body: ReactNode) => (
    <Flexbox gap={8} height={'calc(100% - 52px)'} padding={'0 8px'} style={{ overflow: 'hidden' }}>
      <Flexbox
        height={'100%'}
        style={{ marginInline: -8, overflow: 'hidden', position: 'relative' }}
        width={'calc(100% + 16px)'}
      >
        {body}
      </Flexbox>
    </Flexbox>
  );

  return (
    <Modal
      allowFullscreen
      className={cx(isPortalThread && styles.container)}
      destroyOnHidden
      footer={null}
      height={'95%'}
      onCancel={() => clearPortalStack()}
      open={showMobilePortal}
      styles={{
        body: { padding: 0 },
        header: { display: 'none' },
      }}
      title={t('title')}
    >
      <PortalContent renderBody={renderBody} />
    </Modal>
  );
};

export default Layout;
