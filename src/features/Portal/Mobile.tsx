'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import { PortalContent } from './router';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    background: linear-gradient(${cssVar.colorBgElevated}, ${cssVar.colorBgContainer}) !important;
  `,
}));

const MobilePortal = () => {
  const [showMobilePortal, isPortalThread, clearPortalStack] = useChatStore((state) => [
    state.showPortal,
    portalThreadSelectors.showThread(state),
    state.clearPortalStack,
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
    <ImperativeModal
      allowFullscreen
      destroyOnHidden
      className={cx(isPortalThread && styles.container)}
      footer={null}
      height={'95%'}
      open={showMobilePortal}
      title={t('title')}
      styles={{
        body: { padding: 0 },
        header: { display: 'none' },
      }}
      onCancel={() => clearPortalStack()}
    >
      <PortalContent renderBody={renderBody} />
    </ImperativeModal>
  );
};

export default MobilePortal;
