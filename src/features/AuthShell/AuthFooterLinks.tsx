'use client';

import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';

const styles = stylex.create({
  link: { cursor: 'pointer', color: { 'default': 'inherit', ':visited': cssVar.colorLinkActive } },
});

const AuthFooterLinks = memo(() => {
  const { t } = useTranslation('auth');
  return (
    <Text align={'center'} fontSize={13} type={'secondary'}>
      <a {...stylex.props(styles.link)} href={TERMS_URL} rel="noopener noreferrer" target="_blank">
        {t('footer.terms')}
      </a>
      <span style={{ marginInline: 8 }}>·</span>
      <a
        {...stylex.props(styles.link)}
        href={PRIVACY_URL}
        rel="noopener noreferrer"
        target="_blank"
      >
        {t('footer.privacy')}
      </a>
    </Text>
  );
});

export default AuthFooterLinks;
