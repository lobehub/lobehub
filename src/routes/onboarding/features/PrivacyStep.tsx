'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { cssVar } from 'antd-style';
import { ShieldCheck, Undo2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';
import { useUserStore } from '@/store/user';

interface PrivacyStepProps {
  onBack: () => void;
  onNext: () => Promise<void> | void;
}

const PrivacyStep = memo<PrivacyStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');
  const [check, setCheck] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const handleChoice = useCallback(
    async (enabled: boolean) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      setIsNavigating(true);
      await updateGeneralConfig({ telemetry: enabled });
      await onNext();
    },
    [updateGeneralConfig, onNext],
  );

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    onBack();
  }, [onBack]);

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Text as={'p'} color={cssVar.colorTextSecondary}>
          {t('telemetry.rows.privacy.desc', { appName: BRANDING_NAME })}
        </Text>
        <Flexbox horizontal align="center" gap={8}>
          <Switch checked={check} size={'small'} onChange={(v) => setCheck(v)} />
          <Text fontSize={12} type={check ? undefined : 'secondary'}>
            {t('telemetry.rows.privacy.title', { appName: BRANDING_NAME })}
          </Text>
        </Flexbox>
      </Flexbox>
      <Button
        disabled={isNavigating}
        size={'large'}
        type="primary"
        style={{
          marginBlock: 8,
          maxWidth: 240,
        }}
        onClick={() => handleChoice(check)}
      >
        {t('telemetry.next')}
      </Button>
      {check && (
        <Block horizontal align="flex-start" gap={8} variant={'borderless'}>
          <Icon
            icon={ShieldCheck}
            size={16}
            style={{ color: cssVar.colorSuccess, flexShrink: 0 }}
          />
          <Text fontSize={12} type="secondary">
            <Trans
              i18nKey={'telemetry.agreement'}
              ns={'onboarding'}
              components={{
                privacy: (
                  <a
                    href={PRIVACY_URL}
                    style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {t('telemetry.terms')}
                  </a>
                ),
                terms: (
                  <a
                    href={TERMS_URL}
                    style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {t('telemetry.privacy')}
                  </a>
                ),
              }}
            />
          </Text>
        </Block>
      )}
      <Flexbox horizontal justify={'flex-start'} style={{ marginTop: 32 }}>
        <Button
          disabled={isNavigating}
          icon={Undo2Icon}
          type={'text'}
          style={{
            color: cssVar.colorTextDescription,
          }}
          onClick={handleBack}
        >
          {t('back')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

PrivacyStep.displayName = 'PrivacyStep';

export default PrivacyStep;
