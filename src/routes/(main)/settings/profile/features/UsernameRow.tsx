'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { type InputRef, Spin } from 'antd';
import { type ChangeEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { INPUT_WIDTH, labelStyle, rowStyle } from './ProfileRow';

interface UsernameRowProps {
  mobile?: boolean;
}

const UsernameRow = ({ mobile }: UsernameRowProps) => {
  const { t } = useTranslation('auth');
  const username = useUserStore(userProfileSelectors.username);
  const updateUsername = useUserStore((s) => s.updateUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<InputRef>(null);

  const usernameRegex = /^\w+$/;

  const validateUsername = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return t('profile.usernameRequired');
    if (trimmed.length > 64) return t('profile.usernameTooLong');
    if (!usernameRegex.test(trimmed)) return t('profile.usernameRule');
    return '';
  };

  const handleSave = useCallback(async () => {
    const value = inputRef.current?.input?.value?.trim();
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
    if (inputRef.current?.input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeInputValueSetter?.call(inputRef.current.input, username || '');
      inputRef.current.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setError('');
    setDirty(false);
    inputRef.current?.blur();
  }, [username]);

  const input = (
    <Flexbox gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        {saving && <Spin indicator={<LoadingOutlined spin />} size="small" />}
        {error && (
          <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type="danger">
            {error}
          </Text>
        )}
        {dirty && !saving && (
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
              handleCancel();
            }}
            size="small"
            variant="outlined"
          >
            {t('profile.cancel')}
          </Button>
        )}
        <Input
          defaultValue={username || ''}
          disabled={saving}
          key={username}
          placeholder={t('profile.usernamePlaceholder')}
          ref={inputRef}
          status={error ? 'error' : undefined}
          style={mobile ? undefined : { textAlign: 'right', width: INPUT_WIDTH }}
          variant="filled"
          onBlur={handleSave}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              handleCancel();
            }
          }}
          onPressEnter={handleSave}
        />
      </Flexbox>
    </Flexbox>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Text strong>{t('profile.username')}</Text>
        {input}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.username')}</Text>
      <Flexbox align="flex-end" style={{ flex: 1 }}>
        {input}
      </Flexbox>
    </Flexbox>
  );
};

export default UsernameRow;
