'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const styles = stylex.create({
  brand: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'content-box',
    padding: '4px',
    borderRadius: cssVar.borderRadius,
    lineHeight: 0,
    transition: 'background 120ms ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  divider: {
    flex: 'none',
    width: '1px',
    height: '16px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
});

const WorkbenchBrandLink = memo(() => {
  const { t } = useTranslation('verify');
  const label = t('actions.goToApp', { name: BRANDING_NAME });

  return (
    <>
      <a aria-label={label} {...stylex.props(styles.brand)} href={'/'} title={label}>
        <ProductLogo size={22} />
      </a>
      <div {...stylex.props(styles.divider)} />
    </>
  );
});

WorkbenchBrandLink.displayName = 'WorkbenchBrandLink';

export default WorkbenchBrandLink;
