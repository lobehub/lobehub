import { useState } from 'react';

import { useChatStore } from '@/store/chat';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import type { BindDirectoryOptions } from './BindDirectoryModal';

export function useBindDirectory(options: BindDirectoryOptions, onSaved: () => void) {
  const bind = useProjectDirectoryStore((s) => s.bind);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const save = async (projectId: string, environmentId: string) => {
    setPending(true);
    setError(undefined);
    try {
      await bind({
        agentId: options.agentId,
        deviceId: options.deviceId,
        environmentId,
        name: options.path.split(/[\\/]/).findLast(Boolean) || options.path,
        path: options.path,
        projectId,
        topicIds: options.topicIds,
      });
      await useChatStore.getState().refreshTopic();
      onSaved();
    } catch (error) {
      console.error('Failed to bind project directory', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return { error, pending, save };
}
