'use client';

import { Flexbox, Icon, Input } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { Loader2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { saveToast } from '@/store/utils/saveToast';

import ProfileRow from './ProfileRow';

const FullNameRow = () => {
  const { t } = useTranslation('auth');
  const fullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<InputRef>(null);

  const handleSave = async () => {
    const value = inputRef.current?.input?.value?.trim();
    if (!value || value === fullName) return;

    try {
      setSaving(true);
      await updateFullName(value);
    } catch (error) {
      console.error('Failed to update fullName:', error);
      saveToast(error, { retry: () => void handleSave(), title: t('profile.saveError') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileRow anchor={'profile-full-name'} label={t('profile.fullName')}>
      <Flexbox horizontal align="center" gap={8}>
        {saving && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />}
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
