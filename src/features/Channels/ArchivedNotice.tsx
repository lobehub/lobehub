import type { ChannelListItem } from '@lobechat/types';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Archive } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';

import { styles } from './styles';
import { useChannelArchive } from './useChannelArchive';

/**
 * Stands in for the composer while the channel, or only this thread, is archived. Owners and
 * admins reopen it from here.
 */
export function ArchivedNotice({
  channel,
  threadId,
}: {
  channel: ChannelListItem;
  threadId: string | null;
}) {
  const { t } = useTranslation('channel');
  const { setThreadArchived, unarchive } = useChannelArchive();
  const [busy, setBusy] = useState(false);
  const threadOnly = channel.status !== 'archived' && !!threadId;

  const reopen = async () => {
    setBusy(true);
    try {
      await (threadOnly ? setThreadArchived(channel.id, threadId, false) : unarchive(channel.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WideScreenContainer fullWidth paddingInline={24}>
      <div role="status" {...stylex.props(styles.archivedNotice)}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Icon icon={Archive} size={16} />
          <span>{t(threadOnly ? 'threadArchivedNotice' : 'archivedNotice')}</span>
        </Flexbox>
        {channel.canDelete && (
          <Button loading={busy} size="small" onClick={() => void reopen()}>
            {t(threadOnly ? 'unarchiveThread' : 'unarchive')}
          </Button>
        )}
      </div>
    </WideScreenContainer>
  );
}
