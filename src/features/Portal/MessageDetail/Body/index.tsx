// oxlint-disable-next-line stylex-migration/no-emotion-styles -- Markdown output gets no className
import { createStaticStyles, Flexbox, Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  md: { overflow: 'scroll' },
});

const fallback = createStaticStyles(({ css }) => ({
  md: css`
    > div {
      padding-block-end: 40px;
    }
  `,
}));

const MessageDetailBody = () => {
  const [messageDetailId, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.messageDetailId(s),
    s.clearPortalStack,
  ]);

  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageDetailId || ''), isEqual);

  const content = message?.content || '';

  useEffect(() => {
    if (!message) {
      clearPortalStack();
    }
  }, [message]);

  return (
    <Flexbox height={'100%'} paddingBlock={'0 12px'} paddingInline={8}>
      {!!content && (
        <Markdown {...sx(styles.md, fallback.md)} variant={'chat'}>
          {content}
        </Markdown>
      )}
    </Flexbox>
  );
};

export default MessageDetailBody;
