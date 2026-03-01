'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { type ChangeEvent } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { labelStyle, rowStyle } from './ProfileRow';

interface UsernameRowProps {
  mobile?: boolean;
}

const UsernameRow = ({ mobile }: UsernameRowProps) => {
  const { t } = useTranslation('auth');
  const username = useUserStore(userProfileSelectors.username);
  const updateUsername = useUserStore((s) => s.updateUsername);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const usernameRegex = /^\w+$/;

  const handleStartEdit = () => {
    setEditValue(username || '');
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setError('');
  };

  const validateUsername = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return t('profile.usernameRequired');
    if (!usernameRegex.test(trimmed)) return t('profile.usernameRule');
    return '';
  };

  const handleSave = useCallback(async () => {
    const validationError = validateUsername(editValue);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError('');
      await updateUsername(editValue.trim());
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to update username:', err);
      // Handle duplicate username error
      if (err?.data?.code === 'CONFLICT' || err?.message === 'USERNAME_TAKEN') {
        setError(t('profile.usernameDuplicate'));
      } else {
        setError(t('profile.usernameUpdateFailed'));
      }
    } finally {
      setSaving(false);
    }
  }, [editValue, updateUsername, t]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditValue(value);

    if (!value.trim()) {
      setError('');
      return;
    }

    if (!usernameRegex.test(value)) {
      setError(t('profile.usernameRule'));
      return;
    }

    setError('');
  };

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        {!mobile && <Text strong>{t('profile.usernameInputHint')}</Text>}
        <Input
          autoFocus
          placeholder={t('profile.usernamePlaceholder')}
          status={error ? 'error' : undefined}
          value={editValue}
          onChange={handleInputChange}
          onPressEnter={handleSave}
        />
        {error && (
          <Text style={{ fontSize: 12 }} type="danger">
            {error}
          </Text>
        )}
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
        <Text>{username || '--'}</Text>
      ) : (
        <Flexbox horizontal align="center" justify="space-between">
          <Text>{username || '--'}</Text>
          <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
            {t('profile.updateUsername')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong>{t('profile.username')}</Text>
          {!isEditing && (
            <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
              {t('profile.updateUsername')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.username')}</Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
};

export default UsernameRow;
