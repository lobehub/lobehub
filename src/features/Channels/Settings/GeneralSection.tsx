import type { ChannelListItem } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { Button, Input, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { FormCard } from './FormCard';
import { settingsStyles } from './styles';

export function GeneralSection({ channel }: { channel: ChannelListItem }) {
  const { t } = useTranslation('channel');
  const [title, setTitle] = useState(channel.title);
  const [saving, setSaving] = useState(false);
  const archived = channel.status === 'archived';
  const next = title.trim();

  const save = async () => {
    setSaving(true);
    try {
      await channelActions.rename(channel.id, next);
      toast.success(t('settings.saved'));
    } catch (error) {
      console.error('Failed to rename Channel', error);
      toast.error(t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'renameForbidden' : 'renameFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormCard
      description={t('settings.general.nameDescription')}
      hint={t('settings.general.nameLimit', { count: CHANNEL_LIMITS.titleLength })}
      title={t('settings.general.name')}
      action={
        <Button
          disabled={archived || !next || next === channel.title}
          loading={saving}
          type="primary"
          onClick={save}
        >
          {t('settings.save')}
        </Button>
      }
    >
      <div {...stylex.props(settingsStyles.field)}>
        <Input
          aria-label={t('settings.general.name')}
          disabled={archived}
          maxLength={CHANNEL_LIMITS.titleLength}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
    </FormCard>
  );
}
