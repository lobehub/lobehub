'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { AnimatePresence, m } from 'motion/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { changeEmail } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const EmailRow = () => {
  const { t } = useTranslation('auth');
  const email = useUserStore(userProfileSelectors.email);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleStartEdit = () => {
    setEditValue('');
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setError('');
  };

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;

    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t('profile.emailInvalid'));
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await changeEmail({ callbackURL: '/settings/profile', newEmail: trimmed });
      if (res.error) {
        setError(res.error.message ?? res.error.statusText ?? 'Failed to change email');
        return;
      }
      setIsEditing(false);
      message.success(t('profile.emailChangeSuccess'));
    } catch (err) {
      console.error('Failed to change email:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editValue, t]);

  const editingContent = (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        <Input
          autoFocus
          placeholder={t('profile.emailPlaceholder')}
          status={error ? 'error' : undefined}
          value={editValue}
          onPressEnter={handleSave}
          onChange={(e) => {
            setEditValue(e.target.value);
            if (error) setError('');
          }}
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
    </m.div>
  );

  const displayContent = (
    <m.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      key="display"
      transition={{ duration: 0.2 }}
    >
      <Text>{email || '--'}</Text>
    </m.div>
  );

  return (
    <ProfileRow
      label={t('profile.email')}
      action={
        !isEditing && (
          <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
            {t('profile.updateEmail')}
          </Text>
        )
      }
    >
      <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
    </ProfileRow>
  );
};

export default EmailRow;
