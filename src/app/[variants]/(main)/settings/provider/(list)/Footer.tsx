'use client';

import { Center } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { MORE_MODEL_PROVIDER_REQUEST_URL } from '@/const/url';

const Footer = memo(() => {
  const { t } = useTranslation('setting');
  return (
    <Center
      style={{
        background: cssVar.colorFillQuaternary,
        border: `1px dashed ${cssVar.colorFillSecondary}`,
        borderRadius: cssVar.borderRadiusLG,
        padding: 12,
      }}
      width={'100%'}
    >
      <div style={{ color: cssVar.colorTextSecondary, fontSize: 12, textAlign: 'center' }}>
        <Trans
          components={[
            <span key="0" />,
            <a
              aria-label={t('llm.waitingForMoreLinkAriaLabel')}
              href={MORE_MODEL_PROVIDER_REQUEST_URL}
              key="1"
              rel="noreferrer"
              target="_blank"
            />,
          ]}
          i18nKey="llm.waitingForMore"
          ns={'setting'}
        />
      </div>
    </Center>
  );
});

export default Footer;
