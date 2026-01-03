'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, Flexbox, Select, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Locales, localeOptions, normalizeLocale } from '@/locales/resources';
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

  const handleNext = () => {
    setSettings({ general: { responseLanguage: value || '' } });
    onNext();
  };

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
      <Flexbox align={'center'} gap={12} horizontal>
        <Select
          onChange={(v) => {
            if (v) {
              switchLocale(v);
              setValue(v);
            }
          }}
          optionRender={(item) => (
            <Flexbox key={item.value}>
              <Text>{item.label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`lang.${item.value}` as any, { ns: 'common' })}
              </Text>
            </Flexbox>
          )}
          options={localeOptions}
          showSearch
          size="large"
          style={{
            fontSize: 20,
            fontWeight: 'bold',
            width: '100%',
          }}
          value={value}
        />
        <SendButton
          onClick={handleNext}
          style={{
            zoom: 1.5,
          }}
          type="primary"
        />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('responseLanguage.hint')}
      </Text>
      <Flexbox horizontal justify={'flex-start'} style={{ marginTop: 32 }}>
        <Button
          icon={Undo2Icon}
          onClick={onBack}
          style={{
            color: cssVar.colorTextDescription,
          }}
          type={'text'}
        >
          {t('back')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ResponseLanguageStep.displayName = 'ResponseLanguageStep';

export default ResponseLanguageStep;
