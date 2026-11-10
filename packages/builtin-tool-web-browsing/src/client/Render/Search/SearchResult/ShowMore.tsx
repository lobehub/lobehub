import { Block, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { WebBrowsingManifest } from '../../../../manifest';
import { EngineAvatarGroup } from '../../../components/EngineAvatar';

const styles = stylex.create({
  container: { cursor: 'pointer', padding: '8px', fontSize: '12px', color: 'initial' },
});

interface ShowMoreProps {
  engines: string[];
  messageId: string;
  resultsNumber: number;
  style?: CSSProperties;
}
const ShowMore = memo<ShowMoreProps>(({ style, messageId, engines, resultsNumber }) => {
  const [openToolUI] = useChatStore((s) => [s.openToolUI]);

  const { t } = useTranslation('tool');

  return (
    <Block
      className={stylex.props(styles.container).className}
      gap={2}
      justify={'space-between'}
      style={style}
      variant={'outlined'}
      onClick={() => {
        openToolUI(messageId, WebBrowsingManifest.identifier);
      }}
    >
      <Text ellipsis={{ rows: 2 }}>{t('search.viewMoreResults', { results: resultsNumber })}</Text>
      <Flexbox horizontal align={'center'} gap={4}>
        <EngineAvatarGroup engines={engines} />
      </Flexbox>
    </Block>
  );
});

export default ShowMore;
