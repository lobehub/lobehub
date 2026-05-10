'use client';

import type { InterestAreaKey } from '@lobechat/const';
import { normalizeInterestsForStorage, resolveInterestAreaKey } from '@lobechat/const';
import { Block, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BriefcaseIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const InterestsRow = () => {
  const { t } = useTranslation('auth');
  const { t: tOnboarding } = useTranslation('onboarding');
  const interests = useUserStore(userProfileSelectors.interests);
  const updateInterests = useUserStore((s) => s.updateInterests);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const normalizedInterests = useMemo(() => normalizeInterestsForStorage(interests), [interests]);

  const saveInterests = useCallback(
    async (updated: string[]) => {
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
    [updateInterests],
  );

  const areas = useMemo(
    () =>
      INTEREST_AREAS.map((area) => ({
        ...area,
        label: tOnboarding(`interests.area.${area.key}`),
      })),
    [tOnboarding],
  );

  const toggleInterest = useCallback(
    async (key: InterestAreaKey) => {
      const updated = normalizedInterests.includes(key)
        ? normalizedInterests.filter((i) => i !== key)
        : [...normalizedInterests, key];

      await saveInterests(updated);
    },
    [normalizedInterests, saveInterests],
  );

  const removeCustomInterest = useCallback(
    async (interest: string) => {
      const updated = normalizedInterests.filter((i) => i !== interest);

      await saveInterests(updated);
    },
    [normalizedInterests, saveInterests],
  );

  const handleAddCustom = useCallback(async () => {
    const trimmed = customInput.trim();
    if (!trimmed || normalizedInterests.includes(trimmed)) return;

    const updated = [...normalizedInterests, trimmed];
    setCustomInput('');

    await saveInterests(updated);
  }, [customInput, normalizedInterests, saveInterests]);

  return (
    <ProfileRow label={t('profile.interests')}>
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          {areas.map((item) => {
            const isSelected = normalizedInterests.includes(item.key);
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
                onClick={() => !saving && toggleInterest(item.key)}
              >
                <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={14} />
                <Text fontSize={13} weight={500}>
                  {item.label}
                </Text>
              </Block>
            );
          })}
          {normalizedInterests
            .filter((i) => !resolveInterestAreaKey(i))
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
                onClick={() => !saving && removeCustomInterest(interest)}
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
    </ProfileRow>
  );
};

export default InterestsRow;
