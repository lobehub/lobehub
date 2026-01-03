'use client';

import { Block, Button, Flexbox, Icon, Input, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BriefcaseIcon } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INTEREST_AREAS } from '@/app/[variants]/onboarding/config';
import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
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
  const [isEditing, setIsEditing] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
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

  const handleStartEdit = () => {
    setSelectedInterests([...interests]);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSelectedInterests([]);
    setCustomInput('');
    setShowCustomInput(false);
  };

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

  const handleSave = useCallback(async () => {
    // Include custom input if has content
    const finalInterests = [...selectedInterests];
    const trimmedCustom = customInput.trim();
    if (showCustomInput && trimmedCustom && !finalInterests.includes(trimmedCustom)) {
      finalInterests.push(trimmedCustom);
    }

    // Deduplicate
    const uniqueInterests = [...new Set(finalInterests)];

    try {
      setSaving(true);
      await updateInterests(uniqueInterests);
      setIsEditing(false);
      setSelectedInterests([]);
      setCustomInput('');
      setShowCustomInput(false);
    } catch (error) {
      console.error('Failed to update interests:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
    }
  }, [selectedInterests, customInput, showCustomInput, updateInterests]);

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        <Flexbox align="center" gap={8} horizontal wrap="wrap">
          {areas.map((item) => {
            const isSelected = selectedInterests.includes(item.label);
            return (
              <Block
                clickable
                gap={8}
                horizontal
                key={item.key}
                onClick={() => toggleInterest(item.label)}
                padding={8}
                style={
                  isSelected
                    ? {
                        background: cssVar.colorFillSecondary,
                        borderColor: cssVar.colorFillSecondary,
                      }
                    : {}
                }
                variant="outlined"
              >
                <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={14} />
                <Text fontSize={13} weight={500}>
                  {item.label}
                </Text>
              </Block>
            );
          })}
          {/* Render custom interests with same Block style but no icon */}
          {selectedInterests
            .filter((i) => !areas.some((a) => a.label === i))
            .map((interest) => (
              <Block
                clickable
                key={interest}
                onClick={() => toggleInterest(interest)}
                padding={8}
                style={{
                  background: cssVar.colorFillSecondary,
                  borderColor: cssVar.colorFillSecondary,
                }}
                variant="outlined"
              >
                <Text fontSize={13} weight={500}>
                  {interest}
                </Text>
              </Block>
            ))}
          <Block
            clickable
            gap={8}
            horizontal
            onClick={() => setShowCustomInput(!showCustomInput)}
            padding={8}
            style={
              showCustomInput
                ? { background: cssVar.colorFillSecondary, borderColor: cssVar.colorFillSecondary }
                : {}
            }
            variant="outlined"
          >
            <Icon color={cssVar.colorTextSecondary} icon={BriefcaseIcon} size={14} />
            <Text fontSize={13} weight={500}>
              {tOnboarding('interests.area.other')}
            </Text>
          </Block>
        </Flexbox>
        {showCustomInput && (
          <Input
            onChange={(e) => setCustomInput(e.target.value)}
            onPressEnter={handleAddCustom}
            placeholder={tOnboarding('interests.placeholder')}
            size="small"
            style={{ width: 200 }}
            value={customInput}
          />
        )}
        <Flexbox gap={8} horizontal justify="flex-end">
          <Button disabled={saving} onClick={handleCancel} size="small">
            {t('profile.cancel')}
          </Button>
          <Button loading={saving} onClick={handleSave} size="small" type="primary">
            {t('profile.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </motion.div>
  );

  const displayContent = (
    <motion.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      key="display"
      transition={{ duration: 0.2 }}
    >
      {mobile ? (
        interests.length > 0 ? (
          <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            {interests.map((interest) => (
              <Tag key={interest}>{interest}</Tag>
            ))}
          </Flexbox>
        ) : (
          <Text>--</Text>
        )
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          {interests.length > 0 ? (
            <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
              {interests.map((interest) => (
                <Tag key={interest}>{interest}</Tag>
              ))}
            </Flexbox>
          ) : (
            <Text>--</Text>
          )}
          <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateInterests')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{t('profile.interests')}</Text>
          {!isEditing && (
            <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateInterests')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Text style={labelStyle}>{t('profile.interests')}</Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
};

export default InterestsRow;
