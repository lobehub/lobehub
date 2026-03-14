'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(
  ({ css, cssVar }) => css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
);

export const LayoutSettingsFooterClassName = 'settings-layout-footer';

const Footer = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');

  const { hideGitHub } = useServerConfigStore(featureFlagsSelectors);

  return hideGitHub ? null : (
    <Flexbox className={LayoutSettingsFooterClassName} justify={'flex-end'}>
      <Center
        horizontal
        as={'footer'}
        className={styles}
        flex={'none'}
        padding={16}
        width={'100%'}
      >
        <div style={{ textAlign: 'center' }}>
          {`© ${new Date().getFullYear()} Pictura AI. All rights reserved.`}
        </div>
      </Center>
    </Flexbox>
  );
});

Footer.displayName = 'SettingFooter';

export default Footer;
