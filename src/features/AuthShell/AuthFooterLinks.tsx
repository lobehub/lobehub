'use client';

import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';
import { vendorLink } from '@/utils/vendorLink';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    cursor: pointer;
    color: inherit;

    &:visited {
      color: ${cssVar.colorLinkActive};
    }
  `,
}));

const AuthFooterLinks = memo(() => {
  const { t } = useTranslation('auth');

  const terms = vendorLink(TERMS_URL);
  const privacy = vendorLink(PRIVACY_URL);

  // A build with no legal pages of its own shows nothing here rather than
  // linking to the vendor's — this is the first screen a user sees, and it is
  // the one place where pointing at somebody else's terms is a real problem
  // rather than a cosmetic one.
  if (!terms && !privacy) return null;

  return (
    <Text align={'center'} fontSize={13} type={'secondary'}>
      {terms && (
        <a className={styles.link} href={terms} rel="noopener noreferrer" target="_blank">
          {t('footer.terms')}
        </a>
      )}
      {terms && privacy && <span style={{ marginInline: 8 }}>·</span>}
      {privacy && (
        <a className={styles.link} href={privacy} rel="noopener noreferrer" target="_blank">
          {t('footer.privacy')}
        </a>
      )}
    </Text>
  );
});

export default AuthFooterLinks;
