'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Loader2Icon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import BrandLoading from '@/components/Loading/BrandTextLoading';
import { isEmbeddedAuth } from '@/features/AuthShell/embedded';

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
      <Flexbox align={'center'} gap={12}>
        {/* Lobot's sign-in window shows no LobeHub branding. */}
        {isEmbeddedAuth() ? (
          <Icon spin icon={Loader2Icon} size={24} />
        ) : (
          <BrandLoading debugId={'ouidc'} />
        )}
        <Text fontSize={14}>{t('consent.redirecting')}</Text>
      </Flexbox>
      <form action="/oidc/consent" method="post" ref={formRef} style={{ display: 'none' }}>
        <input name="uid" type="hidden" value={uid} />
        <input name="consent" type="hidden" value="accept" />
      </form>
    </>
  );
});

BuiltinConsent.displayName = 'BuiltinConsent';

export default BuiltinConsent;
