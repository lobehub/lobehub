'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Modal, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';
import AuthCard from '@/features/AuthCard';
import { useIsDark } from '@/hooks/useIsDark';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block-start: 32px;

    background-image: url('/images/community_header_light.webp');
    background-repeat: no-repeat;
    background-position: 400% 0;
    background-size: 400px auto;
    background-blend-mode: multiply;
  `,
  container_dark: css`
    background-image: url('/images/community_header_dark.webp');
    background-blend-mode: screen;
  `,
}));

interface MarketAuthConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}

const MarketAuthConfirmModal = memo<MarketAuthConfirmModalProps>(
  ({ open, onConfirm, onCancel }) => {
    const { t } = useTranslation('marketAuth');
    const isDarkMode = useIsDark();

    const footer = (
      <Text align={'center'} as={'div'} fontSize={13} type={'secondary'}>
        <Trans
          i18nKey={'authorize.footer.agreement'}
          ns={'marketAuth'}
          components={{
            privacy: (
              <a
                href={PRIVACY_URL}
                style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {t('authorize.footer.terms')}
              </a>
            ),
            terms: (
              <a
                href={TERMS_URL}
                style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {t('authorize.footer.privacy')}
              </a>
            ),
          }}
        />
      </Text>
    );
    return (
      <Modal
        centered
        cancelText={t('authorize.cancel')}
        okText={t('authorize.confirm')}
        open={open}
        title={null}
        width={440}
        classNames={{
          container: cx(styles.container, isDarkMode && styles.container_dark),
        }}
        paddings={{
          desktop: 24,
        }}
        onCancel={onCancel}
        onOk={onConfirm}
      >
        <AuthCard
          footer={footer}
          paddingBlock={'40px 20px'}
          subtitle={t('authorize.subtitle')}
          title={t('authorize.title')}
          width={'100%'}
        >
          <Block padding={16} variant={'filled'}>
            <Text align={'center'}>{t('authorize.description', { appName: BRANDING_NAME })}</Text>
          </Block>
        </AuthCard>
      </Modal>
    );
  },
);

MarketAuthConfirmModal.displayName = 'MarketAuthConfirmModal';

export default MarketAuthConfirmModal;
