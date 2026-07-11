'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox, Text } from '@lobehub/ui';
import { Select, Switch } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions, type Locales, normalizeLocale } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';

const Welcome = memo<OnboardingFlowController>(({ next }) => {
  const { i18n, t } = useTranslation('onboarding');
  const switchLocale = useGlobalStore((s) => s.switchLocale);
  const setSettings = useUserStore((s) => s.setSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const language: Locales = normalizeLocale(
    i18n.resolvedLanguage || i18n.language || navigator.language,
  );
  const [telemetry, setTelemetry] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleContinue = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await Promise.all([
        setSettings({ general: { responseLanguage: language } }),
        updateGeneralConfig({ telemetry }),
      ]);
      await next();
    } finally {
      setIsSubmitting(false);
    }
  }, [language, telemetry, setSettings, updateGeneralConfig, next]);

  return (
    <StepCard
      continueLoading={isSubmitting}
      description={t('telemetry.desc')}
      title={t('telemetry.title', { name: BRANDING_NAME })}
      onContinue={handleContinue}
    >
      <Flexbox gap={8}>
        <Text weight={'bold'}>{t('responseLanguage.title')}</Text>
        <Select
          options={localeOptions}
          value={language}
          onChange={(v) => v && switchLocale(v as Locales)}
        />
        <Text fontSize={12} type={'secondary'}>
          {t('responseLanguage.hint')}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text weight={'bold'}>
            {t('telemetry.rows.privacy.title', { appName: BRANDING_NAME })}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('telemetry.rows.privacy.desc', { appName: BRANDING_NAME })}
          </Text>
        </Flexbox>
        <Switch checked={telemetry} onChange={setTelemetry} />
      </Flexbox>
    </StepCard>
  );
});

Welcome.displayName = 'Welcome';

export default Welcome;
