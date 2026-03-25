'use client';

import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import LobeMessage from '../components/LobeMessage';
import { INTEREST_AREAS } from '../config';

interface InterestsStepProps {
  onBack: () => void;
  onNext: () => void;
}

const InterestsStep = memo<InterestsStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');
  const existingInterests = useUserStore(userProfileSelectors.interests);
  const updateInterests = useUserStore((s) => s.updateInterests);

  const [selected, setSelected] = useState<string>(existingInterests?.[0] ?? '');
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const areas = useMemo(
    () =>
      INTEREST_AREAS.map((area) => ({
        ...area,
        label: t(`interests.area.${area.key}`),
      })),
    [t],
  );

  const handleNext = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    updateInterests(selected ? [selected] : []);
    onNext();
  }, [selected, updateInterests, onNext]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  return (
    <Flexbox gap={16}>
      <LobeMessage
        sentences={[t('interests.title'), t('interests.title2'), t('interests.title3')]}
      />
      <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
        {areas.map((item) => {
          const isSelected = selected === item.label;
          return (
            <Block
              clickable
              horizontal
              gap={8}
              key={item.key}
              padding={12}
              variant={'outlined'}
              style={
                isSelected
                  ? {
                      background: cssVar.colorFillSecondary,
                      borderColor: cssVar.colorPrimary,
                    }
                  : {}
              }
              onClick={() => setSelected(isSelected ? '' : item.label)}
            >
              <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={16} />
              <Text fontSize={15} weight={500}>
                {item.label}
              </Text>
            </Block>
          );
        })}
      </Flexbox>
      <Flexbox horizontal justify={'space-between'} style={{ marginTop: 32 }}>
        <Button
          disabled={isNavigating}
          icon={Undo2Icon}
          style={{ color: cssVar.colorTextDescription }}
          type={'text'}
          onClick={handleBack}
        >
          {t('back')}
        </Button>
        <Button disabled={isNavigating} type={'primary'} onClick={handleNext}>
          {t('next')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

InterestsStep.displayName = 'InterestsStep';

export default InterestsStep;
