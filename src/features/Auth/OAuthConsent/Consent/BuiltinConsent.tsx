'use client';

import { Text } from '@lobehub/ui';
import { Result } from 'antd';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import BrandLoading from '@/components/Loading/BrandTextLoading';

interface BuiltinConsentProps {
  uid: string;
}

const BuiltinConsent = memo<BuiltinConsentProps>(({ uid }) => {
  const { t } = useTranslation('oauth');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Auto-submit on mount
    formRef.current?.submit();
  }, []);

  return (
    <>
      <Result
        icon={<BrandLoading debugId={'ouidc'} />}
        status="success"
        title={<Text fontSize={14}>{t('consent.redirecting')}</Text>}
      />
      <form action="/oidc/consent" method="post" ref={formRef} style={{ display: 'none' }}>
        <input name="uid" type="hidden" value={uid} />
        <input name="consent" type="hidden" value="accept" />
      </form>
    </>
  );
});

BuiltinConsent.displayName = 'BuiltinConsent';

export default BuiltinConsent;
