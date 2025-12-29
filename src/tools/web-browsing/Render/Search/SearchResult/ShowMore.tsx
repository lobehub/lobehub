import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { WebBrowsingManifest } from '@/tools/web-browsing';

import { EngineAvatarGroup } from '../../../components/EngineAvatar';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;
    padding: 8px;
    font-size: 12px;
    color: initial;
  `,
}));

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
      className={styles.container}
      gap={2}
      justify={'space-between'}
      onClick={() => {
        openToolUI(messageId, WebBrowsingManifest.identifier);
      }}
      style={style}
      variant={'outlined'}
    >
      <Text ellipsis={{ rows: 2 }}>{t('search.viewMoreResults', { results: resultsNumber })}</Text>
      <Flexbox align={'center'} gap={4} horizontal>
        <EngineAvatarGroup engines={engines} />
      </Flexbox>
    </Block>
  );
});

export default ShowMore;
