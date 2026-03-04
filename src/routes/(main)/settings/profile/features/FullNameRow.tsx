'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Flexbox, Input, Text } from '@lobehub/ui';
import { type InputRef, Spin } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { INPUT_WIDTH, labelStyle, rowStyle } from './ProfileRow';

interface FullNameRowProps {
  mobile?: boolean;
}

const FullNameRow = ({ mobile }: FullNameRowProps) => {
  const { t } = useTranslation('auth');
  const fullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<InputRef>(null);

  const handleSave = useCallback(async () => {
    const value = inputRef.current?.input?.value?.trim();
    if (!value || value === fullName) return;

    try {
      setSaving(true);
      await updateFullName(value);
    } catch (error) {
      console.error('Failed to update fullName:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
    }
  }, [fullName, updateFullName]);

  const input = (
    <Flexbox horizontal align="center" gap={8}>
      {saving && <Spin indicator={<LoadingOutlined spin />} size="small" />}
      <Input
        defaultValue={fullName || ''}
        disabled={saving}
        key={fullName}
        placeholder={t('profile.fullName')}
        ref={inputRef}
        style={mobile ? undefined : { textAlign: 'right', width: INPUT_WIDTH }}
        variant="filled"
        onBlur={handleSave}
        onPressEnter={handleSave}
      />
    </Flexbox>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Text strong>{t('profile.fullName')}</Text>
        {input}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.fullName')}</Text>
      <Flexbox align="flex-end" style={{ flex: 1 }}>
        {input}
      </Flexbox>
    </Flexbox>
  );
};

export default FullNameRow;
