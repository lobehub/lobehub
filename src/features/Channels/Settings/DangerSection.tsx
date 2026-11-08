import type { ChannelListItem } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { useChannelArchive } from '../useChannelArchive';
import { useRemoveChannel } from '../useRemoveChannel';
import { Section } from './Section';
import { settingsStyles } from './styles';

export function DangerSection({ channel }: { channel: ChannelListItem }) {
  const { t } = useTranslation('channel');
  const { archive, unarchive } = useChannelArchive();
  const remove = useRemoveChannel();
  const archived = channel.status === 'archived';

  return (
    <Section title={t('settings.danger.title')}>
      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <Flexbox gap={2}>
            <Text weight={500}>{t(archived ? 'unarchive' : 'archive')}</Text>
            <Text fontSize={12} type="secondary">
              {t(archived ? 'settings.danger.unarchiveHint' : 'settings.danger.archiveHint')}
            </Text>
          </Flexbox>
          <Button onClick={() => (archived ? void unarchive(channel.id) : archive(channel))}>
            {t(archived ? 'unarchive' : 'archive')}
          </Button>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          gap={16}
          justify="space-between"
          {...stylex.props(settingsStyles.row)}
        >
          <Flexbox gap={2}>
            <Text weight={500}>{t('moveToTrash')}</Text>
            <Text fontSize={12} type="secondary">
              {t('settings.danger.trashHint')}
            </Text>
          </Flexbox>
          <Button danger onClick={() => remove(channel)}>
            {t('moveToTrash')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Section>
  );
}
