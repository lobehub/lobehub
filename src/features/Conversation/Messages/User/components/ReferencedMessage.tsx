import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Reply } from 'lucide-react';
import { memo } from 'react';

import type { ReferencedMessage as ReferencedMessageData } from '@/store/chat/utils/parseReferencedMessage';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderInlineStartWidth: '3px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  header: { alignItems: 'center', fontWeight: 500, color: cssVar.colorTextTertiary },
  quote: { fontStyle: 'italic', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  text: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '4',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
});

/**
 * The message a bot-channel user replied to, rendered as a quote above their
 * text instead of the raw `<referenced_message>` prompt markup.
 */
const ReferencedMessage = memo<{ reference: ReferencedMessageData }>(({ reference }) => (
  <Flexbox
    className={stylex.props(styles.container).className}
    data-testid="referenced-message"
    gap={2}
  >
    <Flexbox horizontal className={stylex.props(styles.header).className} gap={4}>
      <Reply size={12} />
      <span>{reference.sender}</span>
    </Flexbox>
    {reference.text && <div {...stylex.props(styles.text)}>{reference.text}</div>}
    {reference.selectedQuote && (
      <div {...stylex.props(styles.quote)}>“{reference.selectedQuote}”</div>
    )}
  </Flexbox>
));

ReferencedMessage.displayName = 'UserMessageReferencedMessage';

export default ReferencedMessage;
