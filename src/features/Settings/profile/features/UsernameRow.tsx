'use client';

import { Button, Flexbox, Input, Spin, Text } from '@lobehub/ui';
import { type ChangeEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const UsernameRow = () => {
  const { t } = useTranslation('auth');
  const username = useUserStore(userProfileSelectors.username);
  const updateUsername = useUserStore((s) => s.updateUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const usernameRegex = /^\w+$/;

  const validateUsername = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return t('profile.usernameRequired');
    if (trimmed.length > 64) return t('profile.usernameTooLong');
    if (!usernameRegex.test(trimmed)) return t('profile.usernameRule');
    return '';
  };

  const handleSave = useCallback(async () => {
    const value = inputRef.current?.value?.trim();
    if (!value || value === username) {
      setError('');
      return;
    }

    const validationError = validateUsername(value);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError('');
      await updateUsername(value);
      setDirty(false);
    } catch (err: any) {
      console.error('Failed to update username:', err);
      if (err?.data?.code === 'CONFLICT' || err?.message === 'USERNAME_TAKEN') {
        setError(t('profile.usernameDuplicate'));
      } else {
        setError(t('profile.usernameUpdateFailed'));
      }
    } finally {
      setSaving(false);
    }
  }, [username, updateUsername, t]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDirty(value.trim() !== (username || ''));
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

  const handleCancel = useCallback(() => {
    if (inputRef.current) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeInputValueSetter?.call(inputRef.current, username || '');
      inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setError('');
    setDirty(false);
    inputRef.current?.blur();
  }, [username]);

  return (
    <ProfileRow anchor={'profile-username'} label={t('profile.username')}>
      <Flexbox align="flex-start" gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <Input
            aria-invalid={!!error}
            data-invalid={error ? '' : undefined}
            defaultValue={username || ''}
            disabled={saving}
            key={username}
            placeholder={t('profile.usernamePlaceholder')}
            ref={inputRef}
            variant="filled"
            onBlur={handleSave}
            onChange={handleChange}
            onPressEnter={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
              }
            }}
          />
          {dirty && !saving && (
            <Button
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                handleCancel();
              }}
            >
              {t('profile.cancel')}
            </Button>
          )}
          {saving && <Spin size="small" style={{ opacity: 0.5 }} />}
        </Flexbox>
        {error && (
          <Text fontSize={12} type="danger">
            {error}
          </Text>
        )}
      </Flexbox>
    </ProfileRow>
  );
};

export default UsernameRow;
