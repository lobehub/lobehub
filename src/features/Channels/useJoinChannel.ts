import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '@/store/channel';

/**
 * Joins the Channel being read. Resolves true once the conversation has turned writable; a failure
 * says so in a toast and resolves false, leaving the button to try again.
 */
export const useJoinChannel = (channelId: string, threadId: string | null) => {
  const { t } = useTranslation('channel');
  const [joining, setJoining] = useState(false);

  const join = async () => {
    setJoining(true);
    try {
      await channelActions.joinOpen(channelId, threadId);
      return true;
    } catch (error) {
      console.error('Failed to join Channel', error);
      toast.error(t('browse.joinFailed'));
      return false;
    } finally {
      setJoining(false);
    }
  };

  return { join, joining };
};
