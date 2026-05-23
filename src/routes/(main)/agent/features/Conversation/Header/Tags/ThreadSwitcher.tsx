'use client';

import { Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    overflow: hidden;

    padding-block: 6px;
    padding-inline: 10px;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemActive: css`
    font-weight: 600;
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  trigger: css`
    cursor: pointer;

    overflow: hidden;
    display: inline-block;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 6px;
    border: none;
    border-radius: 6px;

    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: transparent;
    outline: none;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }

    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface ThreadSwitcherProps {
  title: string;
}

const ThreadSwitcher = memo<ThreadSwitcherProps>(({ title }) => {
  const { t } = useTranslation('chat');
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const threads = useChatStore(threadSelectors.currentTopicThreads);
  const switchThread = useChatStore((s) => s.switchThread);

  const handleSwitch = (id: string) => {
    if (id === activeThreadId) return;
    void switchThread(id);
  };

  const content = (
    <Flexbox
      gap={2}
      padding={4}
      style={{
        maxHeight: '50vh',
        maxWidth: 360,
        minWidth: 240,
        overflowY: 'auto',
      }}
    >
      {threads.map((thread) => (
        <div
          className={cx(styles.item, thread.id === activeThreadId && styles.itemActive)}
          key={thread.id}
          onClick={() => handleSwitch(thread.id)}
        >
          {thread.title || t('thread.title')}
        </div>
      ))}
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      classNames={{ trigger: styles.trigger }}
      content={content}
      nativeButton={false}
      placement={'bottomLeft'}
      styles={{ content: { padding: 4 } }}
      trigger={'click'}
    >
      {title}
    </Popover>
  );
});

export default ThreadSwitcher;
