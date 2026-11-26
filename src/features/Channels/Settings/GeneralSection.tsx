import type { ChannelListItem } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { Button, Input, Text, toast } from '@lobehub/ui';
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
  /** Rename failure, shown under the name input it is about so the typed name stays in view. */
  const [error, setError] = useState('');
  const archived = channel.status === 'archived';
  const next = title.trim();

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await channelActions.rename(channel.id, next);
      toast.success(t('settings.saved'));
    } catch (err) {
      console.error('Failed to rename Channel', err);
      setError(t(isTrpcErrorCode(err, 'FORBIDDEN') ? 'renameForbidden' : 'renameFailed'));
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
          aria-invalid={!!error || undefined}
          aria-label={t('settings.general.name')}
          disabled={archived}
          maxLength={CHANNEL_LIMITS.titleLength}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError('');
          }}
        />
        {error && (
          <Text fontSize={12} role="alert" type="danger">
            {error}
          </Text>
        )}
      </div>
    </FormCard>
  );
}
