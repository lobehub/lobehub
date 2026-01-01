import { memo } from 'react';

import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';

import { useProfileStore } from './store';

const ProfileHydration = memo(() => {
  // Initialize agent builder builtin agent
  const flushSave = useProfileStore((s) => s.flushSave);
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  return null;
});

export default ProfileHydration;
