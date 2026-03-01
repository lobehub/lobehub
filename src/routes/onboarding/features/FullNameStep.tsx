'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, Flexbox, Icon, Input } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SignatureIcon, Undo2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import LobeMessage from '../components/LobeMessage';

interface FullNameStepProps {
  onBack: () => void;
  onNext: () => void;
}

const FullNameStep = memo<FullNameStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');
  const existingFullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);

  const [value, setValue] = useState(existingFullName || '');
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    if (value.trim()) {
      updateFullName(value.trim());
    }
    onNext();
  }, [value, updateFullName, onNext]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={[t('username.title'), t('username.title2'), t('username.title3')]} />
      <Flexbox horizontal align={'center'} gap={12}>
        <Input
          autoFocus
          placeholder={t('username.placeholder')}
          size="large"
          title={t('username.hint')}
          value={value}
          prefix={
            <Icon
              color={cssVar.colorTextDescription}
              icon={SignatureIcon}
              size={32}
              style={{
                marginInline: 8,
              }}
            />
          }
          styles={{
            input: {
              fontSize: 28,
              fontWeight: 'bolder',
            },
          }}
          suffix={
            <SendButton
              disabled={!value?.trim() || isNavigating}
              type="primary"
              style={{
                zoom: 1.5,
              }}
              onClick={handleNext}
            />
          }
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={handleNext}
        />
      </Flexbox>
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

FullNameStep.displayName = 'FullNameStep';

export default FullNameStep;
