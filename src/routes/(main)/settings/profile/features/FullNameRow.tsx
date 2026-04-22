'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Flexbox, Input } from '@lobehub/ui';
import { type InputRef, Spin } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const FullNameRow = () => {
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

  return (
    <ProfileRow label={t('profile.fullName')}>
      <Flexbox horizontal align="center" gap={8}>
        {saving && <Spin indicator={<LoadingOutlined spin />} size="small" />}
        <Input
          defaultValue={fullName || ''}
          disabled={saving}
          key={fullName}
          placeholder={t('profile.fullName')}
          ref={inputRef}
          variant="filled"
          onBlur={handleSave}
          onPressEnter={handleSave}
        />
      </Flexbox>
    </ProfileRow>
  );
};

export default FullNameRow;
