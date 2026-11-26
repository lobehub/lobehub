'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, cssVar, Flexbox, Select, Text } from '@lobehub/ui';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';
import { useUserStore } from '@/store/user';

import LobeMessage from '../components/LobeMessage';

interface ResponseLanguageStepProps {
  onBack: () => void;
  onNext: () => Promise<void> | void;
}

const ResponseLanguageStep = memo<ResponseLanguageStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation(['onboarding', 'common', 'setting']);
  const setSettings = useUserStore((s) => s.setSettings);

  const [value, setValue] = useState(
    () => useUserStore.getState().settings?.general?.responseLanguage || 'auto',
  );
  const [isNavigating, setIsNavigating] = useState(false);
  const [hasError, setHasError] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    setHasError(false);
    try {
      // This write is the sole gate for the whole onboarding flow
      // (`commonStepsCompleted` keys off `responseLanguage`), so it must be able
      // to fail: on error reset the navigating lock so the user can retry
      // instead of being stuck with both buttons permanently disabled
      //
      await setSettings({ general: { responseLanguage: value === 'auto' ? '' : value } });
      await onNext();
    } catch {
      setHasError(true);
      isNavigatingRef.current = false;
      setIsNavigating(false);
    }
  }, [value, setSettings, onNext]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  const sentences = useMemo(
    () => [t('responseLanguage.title'), t('responseLanguage.title2'), t('responseLanguage.title3')],
    [t],
  );

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={sentences} />
      <Flexbox horizontal align={'center'} gap={12}>
        <Select
          showSearch
          size="large"
          value={value}
          optionRender={(item) => (
            <Flexbox key={item.value}>
              <Text>{item.label}</Text>
              {item.value !== 'auto' && (
                <Text fontSize={12} type={'secondary'}>
                  {t(`lang.${item.value}` as any, { ns: 'common' })}
                </Text>
              )}
            </Flexbox>
          )}
          options={[
            { label: t('settingCommon.responseLanguage.auto', { ns: 'setting' }), value: 'auto' },
            ...localeOptions,
          ]}
          style={{
            fontSize: 20,
            fontWeight: 'bold',
            width: '100%',
          }}
          onChange={setValue}
        />
        <SendButton
          disabled={isNavigating}
          type="primary"
          style={{
            zoom: 1.5,
          }}
          onClick={handleNext}
        />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('responseLanguage.hint')}
      </Text>
      {hasError && (
        <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
          {t('responseLanguage.saveFailed')}
        </Text>
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

ResponseLanguageStep.displayName = 'ResponseLanguageStep';

export default ResponseLanguageStep;
