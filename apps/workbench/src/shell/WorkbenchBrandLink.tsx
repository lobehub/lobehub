'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const styles = createStaticStyles(({ css }) => ({
  brand: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    box-sizing: content-box;
    padding: 4px;
    border-radius: ${cssVar.borderRadius};

    line-height: 0;

    transition: background 120ms ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  divider: css`
    flex: none;
    width: 1px;
    height: 16px;
    background: ${cssVar.colorBorderSecondary};
  `,
}));

const WorkbenchBrandLink = memo(() => {
  const { t } = useTranslation('verify');
  const label = t('actions.goToApp', { name: BRANDING_NAME });

  return (
    <>
      <a aria-label={label} className={styles.brand} href={'/'} title={label}>
        <ProductLogo size={22} />
      </a>
      <div className={styles.divider} />
    </>
  );
});

WorkbenchBrandLink.displayName = 'WorkbenchBrandLink';

export default WorkbenchBrandLink;
