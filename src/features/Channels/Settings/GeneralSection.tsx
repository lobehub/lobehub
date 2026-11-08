import type { ChannelListItem } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { Button, Flexbox, Input, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { Section } from './Section';

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
    <Section title={t('settings.general.title')}>
      <Flexbox horizontal gap={8}>
        <Input
          aria-label={t('settings.general.name')}
          disabled={archived}
          maxLength={CHANNEL_LIMITS.titleLength}
          placeholder={t('settings.general.name')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          disabled={archived || !next || next === channel.title}
          loading={saving}
          onClick={save}
        >
          {t('settings.save')}
        </Button>
      </Flexbox>
    </Section>
  );
}
