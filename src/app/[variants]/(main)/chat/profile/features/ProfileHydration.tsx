import { memo } from 'react';

import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';

import { useProfileStore } from './store';

const ProfileHydration = memo(() => {
  const flushSave = useProfileStore((s) => s.flushSave);
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  return null;
});

export default ProfileHydration;
