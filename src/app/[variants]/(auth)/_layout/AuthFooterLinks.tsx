'use client';

import { Text } from '@lobehub/ui';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';

const linkStyle: CSSProperties = {
  color: 'inherit',
  cursor: 'pointer',
};

const AuthFooterLinks = memo(() => {
  const { t } = useTranslation('auth');
  return (
    <Text align={'center'} fontSize={13} type={'secondary'}>
      <a href={TERMS_URL} style={linkStyle}>
        {t('footer.terms')}
      </a>
      <span style={{ marginInline: 8 }}>·</span>
      <a href={PRIVACY_URL} style={linkStyle}>
        {t('footer.privacy')}
      </a>
    </Text>
  );
});

export default AuthFooterLinks;
