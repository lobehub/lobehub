import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import ThreadItem from './ThreadItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;

    padding-block: 8px 4px;
    padding-inline: 4px;
    border-radius: 6px;

    background: ${cssVar.colorFillQuaternary};
  `,
  container_dark: css`
    background: ${cssVar.colorFillTertiary};
  `,
}));

interface ThreadProps {
  id: string;
  placement: 'start' | 'end';
  style?: CSSProperties;
}

const Thread = memo<ThreadProps>(({ id, placement, style }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();

  const threads = useChatStore(threadSelectors.getThreadsBySourceMsgId(id), isEqual);

  return (
    <Flexbox
      direction={placement === 'end' ? 'horizontal-reverse' : 'horizontal'}
      gap={12}
      paddingInline={16}
      style={{ marginTop: -12, paddingBottom: 16, ...style }}
    >
      <div style={{ width: 40 }} />
      <Flexbox
        className={cx(styles.container, isDarkMode && styles.container_dark)}
        gap={4}
        padding={4}
        style={{ width: 'fit-content' }}
      >
        <Flexbox horizontal gap={8} paddingInline={6}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('thread.title')}
            {threads.length}
          </Text>
        </Flexbox>
        <Flexbox>
          {threads.map((thread) => (
            <ThreadItem key={thread.id} {...thread} />
          ))}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Thread;
