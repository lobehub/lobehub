'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, Flexbox, Icon, Input } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SignatureIcon, Undo2Icon } from 'lucide-react';
import { memo, useState } from 'react';
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

  const handleNext = () => {
    if (value.trim()) {
      updateFullName(value.trim());
    }
    onNext();
  };

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={[t('username.title'), t('username.title2'), t('username.title3')]} />
      <Flexbox align={'center'} gap={12} horizontal>
        <Input
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={handleNext}
          placeholder={t('username.placeholder')}
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
          size="large"
          styles={{
            input: {
              fontSize: 28,
              fontWeight: 'bolder',
            },
          }}
          suffix={
            <SendButton
              disabled={!value?.trim()}
              onClick={handleNext}
              style={{
                zoom: 1.5,
              }}
              type="primary"
            />
          }
          title={t('username.hint')}
          value={value}
        />
      </Flexbox>
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

FullNameStep.displayName = 'FullNameStep';

export default FullNameStep;
