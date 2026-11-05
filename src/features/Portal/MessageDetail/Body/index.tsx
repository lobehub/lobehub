// oxlint-disable-next-line stylex-migration/no-plain-css -- the padding goes on the direct div children of the rendered markdown, which lobe-ui Markdown creates with no slot
import './index.css';

import { cx, Flexbox, Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';

const styles = stylex.create({
  md: { overflow: 'scroll' },
});

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
        <Markdown
          className={cx(stylex.props(styles.md).className, 'lobe-body-b06ffb5c-md')}
          variant={'chat'}
        >
          {content}
        </Markdown>
      )}
    </Flexbox>
  );
};

export default MessageDetailBody;
