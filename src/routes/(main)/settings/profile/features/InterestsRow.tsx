'use client';

import { Block, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BriefcaseIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { labelStyle, rowStyle } from './ProfileRow';

interface InterestsRowProps {
  mobile?: boolean;
}

const InterestsRow = ({ mobile }: InterestsRowProps) => {
  const { t } = useTranslation('auth');
  const { t: tOnboarding } = useTranslation('onboarding');
  const interests = useUserStore(userProfileSelectors.interests);
  const updateInterests = useUserStore((s) => s.updateInterests);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);

  const areas = useMemo(
    () =>
      INTEREST_AREAS.map((area) => ({
        ...area,
        label: tOnboarding(`interests.area.${area.key}`),
      })),
    [tOnboarding],
  );

  const toggleInterest = useCallback(
    async (label: string) => {
      const updated = interests.includes(label)
        ? interests.filter((i) => i !== label)
        : [...interests, label];

      try {
        setSaving(true);
        await updateInterests(updated);
      } catch (error) {
        console.error('Failed to update interests:', error);
        fetchErrorNotification.error({
          errorMessage: error instanceof Error ? error.message : String(error),
          status: 500,
        });
      } finally {
        setSaving(false);
      }
    },
    [interests, updateInterests],
  );

  const handleAddCustom = useCallback(async () => {
    const trimmed = customInput.trim();
    if (!trimmed || interests.includes(trimmed)) return;

    const updated = [...interests, trimmed];
    setCustomInput('');

    try {
      setSaving(true);
      await updateInterests(updated);
    } catch (error) {
      console.error('Failed to update interests:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
    }
  }, [customInput, interests, updateInterests]);

  const content = (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" gap={8} justify="flex-end" wrap="wrap">
        {areas.map((item) => {
          const isSelected = interests.includes(item.label);
          return (
            <Block
              clickable
              horizontal
              gap={8}
              key={item.key}
              padding={8}
              variant="outlined"
              style={
                isSelected
                  ? {
                      background: cssVar.colorFillSecondary,
                      borderColor: cssVar.colorFillSecondary,
                      opacity: saving ? 0.6 : 1,
                    }
                  : { opacity: saving ? 0.6 : 1 }
              }
              onClick={() => !saving && toggleInterest(item.label)}
            >
              <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={14} />
              <Text fontSize={13} weight={500}>
                {item.label}
              </Text>
            </Block>
          );
        })}
        {/* Render custom interests */}
        {interests
          .filter((i) => !areas.some((a) => a.label === i))
          .map((interest) => (
            <Block
              clickable
              key={interest}
              padding={8}
              variant="outlined"
              style={{
                background: cssVar.colorFillSecondary,
                borderColor: cssVar.colorFillSecondary,
                opacity: saving ? 0.6 : 1,
              }}
              onClick={() => !saving && toggleInterest(interest)}
            >
              <Text fontSize={13} weight={500}>
                {interest}
              </Text>
            </Block>
          ))}
        <Block
          clickable
          horizontal
          gap={8}
          padding={8}
          variant="outlined"
          style={
            showCustomInput
              ? { background: cssVar.colorFillSecondary, borderColor: cssVar.colorFillSecondary }
              : {}
          }
          onClick={() => setShowCustomInput(!showCustomInput)}
        >
          <Icon color={cssVar.colorTextSecondary} icon={BriefcaseIcon} size={14} />
          <Text fontSize={13} weight={500}>
            {tOnboarding('interests.area.other')}
          </Text>
        </Block>
      </Flexbox>
      {showCustomInput && (
        <Input
          placeholder={tOnboarding('interests.placeholder')}
          size="small"
          style={{ width: 200 }}
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onPressEnter={handleAddCustom}
        />
      )}
    </Flexbox>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Text strong>{t('profile.interests')}</Text>
        {content}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.interests')}</Text>
      <Flexbox align="flex-end" style={{ flex: 1 }}>{content}</Flexbox>
    </Flexbox>
  );
};

export default InterestsRow;
