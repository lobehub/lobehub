'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, Flexbox, Select, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Locales } from '@/locales/resources';
import { localeOptions, normalizeLocale } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

import LobeMessage from '../components/LobeMessage';

interface ResponseLanguageStepProps {
  onBack: () => void;
  onNext: () => void;
}

const ResponseLanguageStep = memo<ResponseLanguageStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation(['onboarding', 'common']);
  const switchLocale = useGlobalStore((s) => s.switchLocale);
  const setSettings = useUserStore((s) => s.setSettings);

  const [value, setValue] = useState<Locales | ''>(normalizeLocale(navigator.language));
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    setSettings({ general: { responseLanguage: value || '' } });
    onNext();
  }, [value, setSettings, onNext]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  const Message = useCallback(
    () => (
      <LobeMessage
        sentences={[
          t('responseLanguage.title'),
          t('responseLanguage.title2'),
          t('responseLanguage.title3'),
        ]}
      />
    ),
    [t, value],
  );

  return (
    <Flexbox gap={16}>
      <Message />
      <Flexbox horizontal align={'center'} gap={12}>
        <Select
          showSearch
          options={localeOptions}
          size="large"
          value={value}
          optionRender={(item) => (
            <Flexbox key={item.value}>
              <Text>{item.label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`lang.${item.value}` as any, { ns: 'common' })}
              </Text>
            </Flexbox>
          )}
          style={{
            fontSize: 20,
            fontWeight: 'bold',
            width: '100%',
          }}
          onChange={(v) => {
            if (v) {
              switchLocale(v);
              setValue(v);
            }
          }}
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
