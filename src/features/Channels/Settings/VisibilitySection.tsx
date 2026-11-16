import type { ChannelListItem, ChannelVisibility } from '@lobechat/types';
import { Switch, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { FormCard } from './FormCard';

/** Only a workspace group Channel can be public; a personal one has nobody else to show it to. */
export function VisibilitySection({ channel }: { channel: ChannelListItem }) {
  const { t } = useTranslation('channel');
  const [saving, setSaving] = useState(false);
  const isPublic = channel.visibility === 'public';

  const change = async (visibility: ChannelVisibility) => {
    setSaving(true);
    try {
      await channelActions.setVisibility(channel.id, visibility);
      toast.success(t('settings.saved'));
    } catch (error) {
      console.error('Failed to change the Channel visibility', error);
      toast.error(
        t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'visibilityForbidden' : 'visibilityFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormCard
      title={t('settings.visibility.title')}
      description={t(
        isPublic ? 'settings.visibility.publicHint' : 'settings.visibility.privateHint',
      )}
      headerAction={
        <Switch
          aria-label={t('settings.visibility.title')}
          checked={isPublic}
          disabled={channel.status === 'archived'}
          loading={saving}
          onChange={(checked) => void change(checked ? 'public' : 'private')}
        />
      }
    />
  );
}
