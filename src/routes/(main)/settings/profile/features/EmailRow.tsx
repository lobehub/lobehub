'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { changeEmail } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { labelStyle, rowStyle } from './ProfileRow';

const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

interface EmailRowProps {
  mobile?: boolean;
}

const EmailRow = ({ mobile }: EmailRowProps) => {
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
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        {!mobile && <Text strong>{t('profile.emailInputHint')}</Text>}
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
        <Text>{email || '--'}</Text>
      ) : (
        <Flexbox horizontal align="center" justify="space-between">
          <Text>{email || '--'}</Text>
          <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
            {t('profile.updateEmail')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong>{t('profile.email')}</Text>
          {!isEditing && (
            <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
              {t('profile.updateEmail')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.email')}</Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
};

export default EmailRow;
