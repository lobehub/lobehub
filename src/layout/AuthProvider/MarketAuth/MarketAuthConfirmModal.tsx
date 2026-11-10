'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Text } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { PRIVACY_URL, TERMS_URL } from '@/const/url';
import AuthCard from '@/features/AuthCard';

import type { MarketAuthScene } from './scenes';

interface MarketAuthConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  scene?: MarketAuthScene;
}

const MarketAuthConfirmModal = memo<MarketAuthConfirmModalProps>(
  ({ open, onConfirm, onCancel, scene = 'default' }) => {
    const { t } = useTranslation('marketAuth');

    // Resolve scene-specific copy, falling back to the generic community-profile
    // wording when a scene has no dedicated key.
    const ts = (key: string, options?: Record<string, unknown>): string => {
      const fallback = t(`authorize.${key}` as any, options as any) as string;
      if (scene === 'default') return fallback;
      return t(
        `authorize.scenes.${scene}.${key}` as any,
        {
          ...options,
          defaultValue: fallback,
        } as any,
      ) as string;
    };

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
      <ImperativeModal
        centered
        cancelText={ts('cancel')}
        okText={ts('confirm')}
        open={open}
        title={null}
        width={440}
        paddings={{
          desktop: 24,
        }}
        onCancel={onCancel}
        onOk={onConfirm}
      >
        <AuthCard
          footer={footer}
          paddingBlock={'40px 20px'}
          subtitle={ts('subtitle')}
          title={ts('title')}
          width={'100%'}
        >
          <Block padding={16} variant={'filled'}>
            <Text align={'center'}>{ts('description', { appName: BRANDING_NAME })}</Text>
          </Block>
        </AuthCard>
      </ImperativeModal>
    );
  },
);

MarketAuthConfirmModal.displayName = 'MarketAuthConfirmModal';

export default MarketAuthConfirmModal;
