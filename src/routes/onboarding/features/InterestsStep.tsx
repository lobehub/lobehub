'use client';

import { Block, Button, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BriefcaseIcon, Undo2Icon } from 'lucide-react';
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

  const [selectedInterests, setSelectedInterests] = useState<string[]>(existingInterests);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
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

  const toggleInterest = useCallback((label: string) => {
    setSelectedInterests((prev) =>
      prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label],
    );
  }, []);

  const handleAddCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (trimmed && !selectedInterests.includes(trimmed)) {
      setSelectedInterests((prev) => [...prev, trimmed]);
      setCustomInput('');
    }
  }, [customInput, selectedInterests]);

  const handleNext = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    // Include custom input value if "other" is active and has content
    const finalInterests = [...selectedInterests];
    const trimmedCustom = customInput.trim();
    if (showCustomInput && trimmedCustom) {
      finalInterests.push(trimmedCustom);
    }

    // Deduplicate
    const uniqueInterests = [...new Set(finalInterests)];

    updateInterests(uniqueInterests);
    onNext();
  }, [selectedInterests, customInput, showCustomInput, updateInterests, onNext]);

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
          const isSelected = selectedInterests.includes(item.label);
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
                      borderColor: cssVar.colorFillSecondary,
                    }
                  : {}
              }
              onClick={() => toggleInterest(item.label)}
            >
              <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={16} />
              <Text fontSize={15} weight={500}>
                {item.label}
              </Text>
            </Block>
          );
        })}
        <Block
          clickable
          horizontal
          gap={8}
          padding={12}
          variant={'outlined'}
          style={
            showCustomInput
              ? { background: cssVar.colorFillSecondary, borderColor: cssVar.colorFillSecondary }
              : {}
          }
          onClick={() => setShowCustomInput(!showCustomInput)}
        >
          <Icon color={cssVar.colorTextSecondary} icon={BriefcaseIcon} size={16} />
          <Text fontSize={15} weight={500}>
            {t('interests.area.other')}
          </Text>
        </Block>
      </Flexbox>
      {showCustomInput && (
        <Input
          autoFocus
          placeholder={t('interests.placeholder')}
          size="large"
          title={t('interests.hint')}
          value={customInput}
          prefix={
            <Icon
              color={cssVar.colorTextDescription}
              icon={BriefcaseIcon}
              style={{ marginInline: 8 }}
            />
          }
          onChange={(e) => setCustomInput(e.target.value)}
          onPressEnter={handleAddCustom}
        />
      )}
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
