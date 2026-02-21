import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { type ThreadItem } from '@/types/topic';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  container: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 12px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  extra: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const Item = memo<ThreadItem>(({ id, title, lastActiveAt, sourceMessageId }) => {
  const { t } = useTranslation('chat');
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);
  const [isActive, messageCount] = useChatStore((s) => [
    s.activeThreadId === id,
    chatSelectors.countMessagesByThreadId(id)(s),
  ]);
  const mobile = useIsMobile();
  return (
    <Flexbox
      horizontal
      align={'baseline'}
      className={cx(styles.container, isActive && styles.active)}
      gap={8}
      onClick={() => {
        if (isActive) return;

        openThreadInPortal(id, sourceMessageId);
      }}
    >
      {title}
      <Flexbox horizontal className={styles.extra}>
        {!!messageCount && t('thread.threadMessageCount', { messageCount })}
        {!mobile && ` · ${dayjs(lastActiveAt).format('YYYY-MM-DD')}`}
        <Icon icon={ChevronRight} />
      </Flexbox>
    </Flexbox>
  );
});

export default Item;
