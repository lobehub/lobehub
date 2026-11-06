'use client';

import { Flexbox, Popover } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

const styles = stylex.create({
  item: {
    cursor: 'pointer',
    overflow: 'hidden',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderRadius: '6px',
    fontSize: '13px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    transition: 'background 0.15s',
  },
  itemActive: {
    fontWeight: 600,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  trigger: {
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'inline-block',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.5,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    outline: {
      'default': 'none',
      // Keep a visible landmark for keyboard focus (mirrors DeviceCard).
      ':focus-visible': `2px solid ${cssVar.colorPrimary}`,
    },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
    boxShadow: { 'default': null, ':focus': 'none' },
    transition: 'background 0.15s',
  },
  triggerOpen: { backgroundColor: cssVar.colorFillTertiary },
});

interface ThreadSwitcherProps {
  title: string;
}

const ThreadSwitcher = memo<ThreadSwitcherProps>(({ title }) => {
  const { t } = useTranslation('chat');
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const threads = useChatStore(threadSelectors.currentTopicThreads);
  const switchThread = useChatStore((s) => s.switchThread);
  const [open, setOpen] = useState(false);

  const handleSwitch = (id: string) => {
    // A pick, including the current thread, completes the switcher.
    setOpen(false);
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
          key={thread.id}
          {...stylex.props(styles.item, thread.id === activeThreadId && styles.itemActive)}
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
      classNames={{ trigger: stylex.props(styles.trigger, open && styles.triggerOpen).className }}
      content={content}
      nativeButton={false}
      open={open}
      placement={'bottomLeft'}
      styles={{ content: { padding: 4 } }}
      trigger={'click'}
      onOpenChange={setOpen}
    >
      {title}
    </Popover>
  );
});

export default ThreadSwitcher;
