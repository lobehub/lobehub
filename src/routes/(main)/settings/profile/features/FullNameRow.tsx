'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { labelStyle, rowStyle } from './ProfileRow';

interface FullNameRowProps {
  mobile?: boolean;
}

const FullNameRow = ({ mobile }: FullNameRowProps) => {
  const { t } = useTranslation('auth');
  const fullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleStartEdit = () => {
    setEditValue(fullName || '');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = useCallback(async () => {
    if (!editValue.trim()) return;

    try {
      setSaving(true);
      await updateFullName(editValue.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update fullName:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
    }
  }, [editValue, updateFullName]);

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        {!mobile && <Text strong>{t('profile.fullNameInputHint')}</Text>}
        <Input
          autoFocus
          placeholder={t('profile.fullName')}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onPressEnter={handleSave}
        />
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={saving} size="small" onClick={handleCancel}>
            {t('profile.cancel')}
          </Button>
          <Button loading={saving} size="small" type="primary" onClick={handleSave}>
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
        <Text>{fullName || '--'}</Text>
      ) : (
        <Flexbox horizontal align="center" justify="space-between">
          <Text>{fullName || '--'}</Text>
          <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
            {t('profile.updateFullName')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong>{t('profile.fullName')}</Text>
          {!isEditing && (
            <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
              {t('profile.updateFullName')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.fullName')}</Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
};

export default FullNameRow;
