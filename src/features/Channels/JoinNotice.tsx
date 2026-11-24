import { Button, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';

import { styles } from './styles';
import { useJoinChannel } from './useJoinChannel';

/**
 * Covers the composer while someone reads a Channel they have not joined. Joining swaps the real
 * composer back in.
 */
export function JoinNotice({
  channelId,
  maxWidth,
  threadId,
}: {
  channelId: string;
  maxWidth?: number;
  threadId: string | null;
}) {
  const { t } = useTranslation('channel');
  const { join, joining } = useJoinChannel(channelId, threadId);

  return (
    <WideScreenContainer fullWidth paddingInline={8} style={{ maxWidth }}>
      <div role="status" {...stylex.props(styles.joinNotice)}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Icon icon={LogIn} size={16} />
          <span>{t('joinNotice.title')}</span>
        </Flexbox>
        <Button loading={joining} type="primary" onClick={() => void join()}>
          {t('joinNotice.join')}
        </Button>
      </div>
    </WideScreenContainer>
  );
}
